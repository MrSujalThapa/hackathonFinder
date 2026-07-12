import { randomUUID } from "node:crypto";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, string | number | boolean | null | undefined>;

const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /authorization/i,
  /bearer\s+[a-z0-9._~+/=-]+/i,
  /service[_-]?account/i,
  /private[_-]?key/i,
  /cookie/i,
  /password/i,
  /secret/i,
  /token/i,
];

function redact(value: string): string {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) return "[redacted]";
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

export function safeError(error: unknown): { category: string; message: string } {
  if (error instanceof Error) {
    return { category: error.name || "Error", message: redact(error.message) };
  }
  return { category: "unknown", message: redact(String(error)) };
}

export function logServerEvent(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
): void {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const record = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ),
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export async function withRequestLogging(
  request: Request,
  route: string,
  handler: (requestId: string) => Promise<Response>,
  fields: LogFields = {},
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const startedAt = Date.now();
  try {
    const response = await handler(requestId);
    response.headers.set("x-request-id", requestId);
    logServerEvent(response.ok ? "info" : "warn", "request", {
      requestId,
      route,
      method: request.method,
      status: response.status,
      durationMs: Date.now() - startedAt,
      ...fields,
    });
    return response;
  } catch (error) {
    const safe = safeError(error);
    logServerEvent("error", "request_error", {
      requestId,
      route,
      method: request.method,
      durationMs: Date.now() - startedAt,
      errorCategory: safe.category,
      errorMessage: safe.message,
      ...fields,
    });
    throw error;
  }
}
