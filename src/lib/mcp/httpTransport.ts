import {
  classifyHttpStatus,
  classifyMessageText,
  isAbortError,
  McpError,
  redactSecrets,
} from "@/lib/mcp/errors";
import type {
  JsonRpcResponse,
  McpTransport,
  McpTransportRequest,
  McpTransportResponse,
} from "@/lib/mcp/types";

export const DEFAULT_MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3 MiB

export type HttpMcpTransportOptions = {
  url: string;
  bearerToken: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function isNotification(
  message: McpTransportRequest["message"],
): boolean {
  return !("id" in message);
}

async function readBodyBounded(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new McpError(
        "malformed",
        `MCP response exceeds max size (${declared} > ${maxBytes} bytes)`,
        { status: response.status },
      );
    }
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new McpError(
        "malformed",
        `MCP response exceeds max size (${total} > ${maxBytes} bytes)`,
        { status: response.status },
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

function parseJsonRpc(text: string, status: number): JsonRpcResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new McpError("malformed", "MCP response is not valid JSON", {
      cause: error,
      status,
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new McpError("malformed", "MCP response is not a JSON object", {
      status,
    });
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.jsonrpc !== "2.0") {
    throw new McpError(
      "malformed",
      "MCP response missing jsonrpc 2.0 field",
      { status },
    );
  }

  return parsed as JsonRpcResponse;
}

/**
 * Extract the JSON-RPC response for `requestId` from an SSE body.
 * Prefers the last matching response; ignores notifications/requests.
 */
export function parseSseJsonRpc(
  text: string,
  requestId: string | number | undefined,
  status: number,
): JsonRpcResponse {
  const frames = text.split(/\r?\n\r?\n/);
  let lastMatch: JsonRpcResponse | null = null;
  let lastAny: JsonRpcResponse | null = null;

  for (const frame of frames) {
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n").trim();
    if (!payload || payload === "[DONE]") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    const obj = parsed as JsonRpcResponse;
    if (obj.jsonrpc !== "2.0") continue;
    if ("result" in obj || "error" in obj) {
      lastAny = obj;
      if (
        requestId !== undefined &&
        obj.id !== undefined &&
        obj.id !== null &&
        String(obj.id) === String(requestId)
      ) {
        lastMatch = obj;
      }
    }
  }

  const chosen = lastMatch ?? lastAny;
  if (!chosen) {
    throw new McpError(
      "malformed",
      "SSE response did not contain a JSON-RPC result",
      { status },
    );
  }
  return chosen;
}

function throwForHttpError(
  status: number,
  bodyText: string,
): never {
  const fromStatus = classifyHttpStatus(status);
  const fromBody = classifyMessageText(bodyText);
  const category = fromStatus ?? fromBody ?? "network";
  const snippet = redactSecrets(bodyText).slice(0, 200);
  throw new McpError(
    category,
    `MCP HTTP ${status}${snippet ? `: ${snippet}` : ""}`,
    { status },
  );
}

export function createHttpMcpTransport(
  options: HttpMcpTransportOptions,
): McpTransport {
  const url = options.url;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(
      request: McpTransportRequest,
    ): Promise<McpTransportResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const onOuterAbort = () => controller.abort();
      if (request.signal) {
        if (request.signal.aborted) {
          controller.abort();
        } else {
          request.signal.addEventListener("abort", onOuterAbort, {
            once: true,
          });
        }
      }

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${options.bearerToken}`,
          ...(request.headers ?? {}),
        };

        let response: Response;
        try {
          response = await fetchImpl(url, {
            method: "POST",
            headers,
            body: JSON.stringify(request.message),
            signal: controller.signal,
          });
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) {
            throw new McpError(
              "timeout",
              `MCP request timed out after ${timeoutMs}ms`,
              { cause: error },
            );
          }
          throw new McpError(
            "network",
            `MCP network error: ${redactSecrets(
              error instanceof Error ? error.message : String(error),
            )}`,
            { cause: error },
          );
        }

        const responseHeaders = headerMap(response.headers);
        const bodyText = await readBodyBounded(response, maxBytes);

        if (response.status === 202 || (response.ok && !bodyText.trim())) {
          if (isNotification(request.message)) {
            return {
              status: response.status,
              headers: responseHeaders,
              body: null,
            };
          }
          if (!bodyText.trim()) {
            throw new McpError(
              "malformed",
              "MCP request returned an empty body",
              { status: response.status },
            );
          }
        }

        if (!response.ok) {
          throwForHttpError(response.status, bodyText);
        }

        const contentType = (
          responseHeaders["content-type"] ?? ""
        ).toLowerCase();
        const requestId =
          "id" in request.message ? request.message.id : undefined;

        let body: JsonRpcResponse;
        if (contentType.includes("text/event-stream")) {
          body = parseSseJsonRpc(bodyText, requestId, response.status);
        } else {
          body = parseJsonRpc(bodyText, response.status);
        }

        return {
          status: response.status,
          headers: responseHeaders,
          body,
        };
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onOuterAbort);
      }
    },
  };
}
