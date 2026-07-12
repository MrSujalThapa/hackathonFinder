/**
 * Read-only X MCP connectivity diagnostics.
 * Never prints secrets. Never mutates data / never calls write tools.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "../src/cli/loadEnv";
import {
  evaluateXToolPolicy,
  selectAllowedXTools,
  selectPublicPostSearchTools,
} from "../src/lib/mcp/allowlist";
import { McpClient } from "../src/lib/mcp/client";
import { McpError, redactSecrets } from "../src/lib/mcp/errors";
import { createHttpMcpTransport } from "../src/lib/mcp/httpTransport";
import {
  describeXMcpConfig,
  getXBearerToken,
  getXMcpConfig,
  isXConfigured,
} from "../src/lib/x/config";

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function categoryLabel(error: unknown): string {
  if (error instanceof McpError) return error.category;
  return "unknown";
}

async function main(): Promise<number> {
  console.log("=== X MCP connectivity check ===\n");

  const cwd = process.cwd();
  console.log(`cwd: ${cwd}`);
  console.log("loading env via loadLocalEnv() from repository root");
  loadLocalEnv();

  const config = getXMcpConfig();
  const token = getXBearerToken();

  console.log("\n--- Environment ---");
  console.log(`X_MCP_MODE: ${config.mode}`);
  console.log(`X_MCP_URL: ${present(config.url) ? config.url : "MISSING"}`);
  console.log(`X_BEARER_TOKEN: ${present(token) ? "set" : "MISSING"}`);
  console.log(`config: ${describeXMcpConfig()}`);

  if (!isXConfigured() || !present(token) || !present(config.url)) {
    console.log("\nRESULT: FAIL");
    console.log("category: missing_env");
    console.log(
      "Configure X_MCP_URL and X_BEARER_TOKEN in .env.local (app-only Bearer; no CLIENT_ID/SECRET).",
    );
    return 1;
  }

  console.log("\n--- MCP initialize + tools/list ---");
  const transport = createHttpMcpTransport({
    url: config.url,
    bearerToken: token!,
    timeoutMs: config.requestTimeoutMs,
  });
  const client = new McpClient({ transport });

  try {
    const init = await client.initialize();
    console.log(`protocolVersion: ${init.protocolVersion}`);
    console.log(
      `serverInfo: ${init.serverInfo.name}@${init.serverInfo.version}`,
    );
    console.log(`sessionId: ${client.getSessionId() ?? "(none)"}`);

    const tools = await client.listTools();
    console.log(`tools listed: ${tools.length}`);

    console.log("\n--- Read-only policy (allowed vs blocked) ---");
    const allowed = selectAllowedXTools(tools);
    const blocked = tools.filter(
      (tool) => !evaluateXToolPolicy(tool).allowed,
    );

    console.log(`allowed: ${allowed.length}`);
    for (const tool of allowed) {
      const decision = evaluateXToolPolicy(tool);
      const desc = tool.description?.slice(0, 100) ?? "";
      console.log(
        `  ALLOW ${tool.name}${desc ? ` — ${desc}` : ""} (${decision.reason})`,
      );
    }

    console.log(`blocked: ${blocked.length}`);
    for (const tool of blocked) {
      const decision = evaluateXToolPolicy(tool);
      console.log(`  BLOCK ${tool.name} (${decision.reason})`);
    }

    const searchTools = selectPublicPostSearchTools(tools);
    console.log("\n--- Public post search tools (subset of allowed) ---");
    if (searchTools.length === 0) {
      console.log("(none matched search+post heuristics; report-only)");
    } else {
      for (const tool of searchTools) {
        console.log(`  candidate: ${tool.name}`);
      }
    }

    console.log("\nRESULT: OK");
    console.log(
      "Connected to X MCP, initialized, and listed tools (no tool calls / no mutations).",
    );
    return 0;
  } catch (error) {
    const category = categoryLabel(error);
    const message =
      error instanceof Error
        ? redactSecrets(error.message)
        : redactSecrets(String(error));

    console.log("\nRESULT: FAIL");
    console.log(`category: ${category}`);
    console.log(`message: ${message}`);

    if (category === "auth") {
      console.log(
        "hint: check X_BEARER_TOKEN (app-only Bearer from the X developer portal).",
      );
    } else if (category === "rate_quota") {
      console.log("hint: X API rate limit or credit/quota exhausted.");
    } else if (category === "timeout") {
      console.log(
        `hint: request exceeded X_REQUEST_TIMEOUT_MS=${config.requestTimeoutMs}.`,
      );
    } else if (category === "malformed") {
      console.log("hint: server returned a malformed MCP/JSON-RPC response.");
    } else if (category === "missing_tool") {
      console.log("hint: requested tool was not found on the server.");
    } else if (category === "policy") {
      console.log("hint: tool blocked by code-level read-only allowlist.");
    } else if (category === "network") {
      console.log("hint: network/DNS/TLS failure reaching X_MCP_URL.");
    }

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
      console.error(
        "Unexpected diagnostic failure:",
        redactSecrets(
          error instanceof Error ? error.message : String(error),
        ),
      );
      process.exit(1);
    });
}

export { main as checkXMcp };
