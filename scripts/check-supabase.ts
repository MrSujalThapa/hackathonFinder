/**
 * Read-only Supabase connectivity diagnostics.
 * Never prints secrets. Never mutates data.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "../src/cli/loadEnv";

type FailureCategory =
  | "missing_env"
  | "malformed_url"
  | "dns_network"
  | "tls"
  | "invalid_api_key"
  | "project_paused_or_unavailable"
  | "table_missing"
  | "unknown";

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function classifyError(error: unknown): {
  category: FailureCategory;
  message: string;
  cause: unknown;
} {
  const err = error as {
    message?: string;
    cause?: unknown;
    code?: string;
    name?: string;
  };
  const message = err?.message ?? String(error);
  const cause = err?.cause ?? null;
  const causeObj = cause as {
    code?: string;
    message?: string;
    reason?: string;
    errno?: string;
  } | null;
  const causeCode = causeObj?.code ?? err?.code ?? "";
  const causeMessage = causeObj?.message ?? causeObj?.reason ?? "";
  const combined = `${message} ${causeMessage} ${causeCode}`.toLowerCase();

  if (
    combined.includes("enotfound") ||
    combined.includes("eai_again") ||
    combined.includes("getaddrinfo") ||
    combined.includes("enetunreach") ||
    combined.includes("econnrefused") ||
    combined.includes("econnreset") ||
    combined.includes("etimedout") ||
    combined.includes("network")
  ) {
    return { category: "dns_network", message, cause };
  }

  if (
    combined.includes("certificate") ||
    combined.includes("ssl") ||
    combined.includes("tls") ||
    combined.includes("cert_") ||
    combined.includes("unable to verify")
  ) {
    return { category: "tls", message, cause };
  }

  if (
    combined.includes("invalid api key") ||
    combined.includes("jwt") ||
    combined.includes("unauthorized") ||
    combined.includes("401") ||
    combined.includes("403")
  ) {
    return { category: "invalid_api_key", message, cause };
  }

  if (
    combined.includes("paused") ||
    combined.includes("inactive") ||
    combined.includes("project not found") ||
    combined.includes("503") ||
    combined.includes("502")
  ) {
    return { category: "project_paused_or_unavailable", message, cause };
  }

  if (
    combined.includes("could not find the table") ||
    combined.includes("relation") ||
    combined.includes("does not exist") ||
    combined.includes("42p01")
  ) {
    return { category: "table_missing", message, cause };
  }

  return { category: "unknown", message, cause };
}

function printCause(cause: unknown, indent = "  "): void {
  if (cause == null) {
    console.log(`${indent}cause: (none)`);
    return;
  }
  if (cause instanceof Error) {
    console.log(`${indent}cause.name: ${cause.name}`);
    console.log(`${indent}cause.message: ${cause.message}`);
    const nested = (cause as Error & { cause?: unknown }).cause;
    if (nested) {
      printCause(nested, `${indent}  `);
    }
    const code = (cause as Error & { code?: string }).code;
    if (code) {
      console.log(`${indent}cause.code: ${code}`);
    }
    return;
  }
  if (typeof cause === "object") {
    const obj = cause as Record<string, unknown>;
    for (const key of ["code", "errno", "syscall", "hostname", "message", "reason"]) {
      if (key in obj && obj[key] != null) {
        console.log(`${indent}cause.${key}: ${String(obj[key])}`);
      }
    }
    return;
  }
  console.log(`${indent}cause: ${String(cause)}`);
}

async function main(): Promise<number> {
  console.log("=== Supabase connectivity check ===\n");

  const cwd = process.cwd();
  console.log(`cwd: ${cwd}`);
  console.log(`loading env via loadLocalEnv() from repository root`);
  loadLocalEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  console.log("\n--- Environment ---");
  console.log(`NEXT_PUBLIC_SUPABASE_URL: ${present(url) ? "set" : "MISSING"}`);
  console.log(
    `NEXT_PUBLIC_SUPABASE_ANON_KEY: ${present(anonKey) ? "set" : "MISSING"}`,
  );
  console.log(
    `SUPABASE_SERVICE_ROLE_KEY: ${present(serviceKey) ? "set" : "MISSING"}`,
  );

  if (!present(url) || !present(anonKey) || !present(serviceKey)) {
    console.log("\nRESULT: FAIL");
    console.log("category: missing_env");
    console.log(
      "Configure NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    return 1;
  }

  let hostname = "(unparseable)";
  try {
    const parsed = new URL(url!);
    hostname = parsed.hostname;
    if (!parsed.protocol.startsWith("http")) {
      console.log("\nRESULT: FAIL");
      console.log("category: malformed_url");
      console.log(`hostname: ${hostname}`);
      console.log(`message: URL protocol must be http(s), got ${parsed.protocol}`);
      return 1;
    }
  } catch (error) {
    const { message, cause } = classifyError(error);
    console.log("\nRESULT: FAIL");
    console.log("category: malformed_url");
    console.log(`message: ${message}`);
    printCause(cause);
    return 1;
  }

  console.log(`parsed hostname: ${hostname}`);

  console.log("\n--- HTTP health probe (anon key) ---");
  const restUrl = `${url!.replace(/\/$/, "")}/rest/v1/`;
  try {
    const response = await fetch(restUrl, {
      method: "GET",
      headers: {
        apikey: anonKey!,
        Authorization: `Bearer ${anonKey}`,
      },
    });
    console.log(`GET ${restUrl}`);
    console.log(`status: ${response.status} ${response.statusText}`);

    if (response.status === 401 || response.status === 403) {
      console.log("\nRESULT: FAIL");
      console.log("category: invalid_api_key");
      console.log("message: Supabase rejected the anon key on REST health probe");
      return 1;
    }

    if (response.status === 502 || response.status === 503) {
      console.log("\nRESULT: FAIL");
      console.log("category: project_paused_or_unavailable");
      console.log("message: Supabase project appears paused or unavailable");
      return 1;
    }
  } catch (error) {
    const { category, message, cause } = classifyError(error);
    console.log("\nRESULT: FAIL");
    console.log(`category: ${category}`);
    console.log(`message: ${message}`);
    printCause(cause);
    return 1;
  }

  console.log("\n--- Read-only candidates query (service role) ---");
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase
      .from("candidates")
      .select("id, name, status")
      .limit(1);

    if (error) {
      const classified = classifyError(error);
      let category = classified.category;
      const msg = error.message.toLowerCase();
      if (
        msg.includes("could not find the table") ||
        msg.includes("relation") ||
        msg.includes("schema cache")
      ) {
        category = "table_missing";
      } else if (
        msg.includes("jwt") ||
        msg.includes("invalid api key") ||
        msg.includes("unauthorized")
      ) {
        category = "invalid_api_key";
      }

      console.log("\nRESULT: FAIL");
      console.log(`category: ${category}`);
      console.log(`message: ${error.message}`);
      if (error.code) {
        console.log(`supabase.code: ${error.code}`);
      }
      if (error.details) {
        console.log(`supabase.details: ${error.details}`);
      }
      if (error.hint) {
        console.log(`supabase.hint: ${error.hint}`);
      }
      return 1;
    }

    const rowCount = data?.length ?? 0;
    console.log(`select ok: ${rowCount} row(s) returned (limit 1)`);
    console.log("\nRESULT: OK");
    console.log("Supabase is reachable and candidates table is readable.");
    return 0;
  } catch (error) {
    const { category, message, cause } = classifyError(error);
    console.log("\nRESULT: FAIL");
    console.log(`category: ${category}`);
    console.log(`message: ${message}`);
    printCause(cause);
    return 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("Unexpected diagnostic failure:", error);
      process.exit(1);
    });
}

export { main as checkSupabase };
