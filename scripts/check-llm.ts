/**
 * Read-only LLM connectivity diagnostics.
 * Never prints secrets. Sends one tiny prompt when live config exists.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "../src/cli/loadEnv";
import { describeLlmConfig, readLlmConfig } from "../src/lib/llm/config";
import { createLlmProvider } from "../src/lib/llm/createProvider";
import { LlmError, redactLlmSecrets } from "../src/lib/llm/errors";

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function categoryLabel(error: unknown): string {
  if (error instanceof LlmError) return error.category;
  return "unknown";
}

async function main(): Promise<number> {
  console.log("=== LLM connectivity check ===\n");

  console.log(`cwd: ${process.cwd()}`);
  console.log("loading env via loadLocalEnv() from repository root");
  loadLocalEnv();

  const config = readLlmConfig();
  console.log("\n--- Environment ---");
  console.log(`LLM_PROVIDER: ${process.env.LLM_PROVIDER?.trim() || "MISSING"}`);
  console.log(`LLM_MODEL: ${process.env.LLM_MODEL?.trim() || "(default)"}`);
  console.log(
    `LLM_API_KEY: ${present(process.env.LLM_API_KEY) ? "set" : "MISSING"}`,
  );
  console.log(`config: ${describeLlmConfig()}`);

  if (!config) {
    console.log("\nRESULT: FAIL");
    console.log("category: missing_env");
    console.log(
      "Configure LLM_PROVIDER (openai|mock) and LLM_API_KEY for live providers.",
    );
    return 1;
  }

  if (config.provider === "mock") {
    const provider = createLlmProvider({ instrument: false });
    const response = await provider.generate({
      messages: [{ role: "user", content: "ping" }],
      maxOutputTokens: 16,
    });
    console.log("\n--- Mock generation ---");
    console.log(`provider: ${response.provider}`);
    console.log(`model: ${response.model}`);
    console.log(`text: ${response.text}`);
    console.log("\nRESULT: OK");
    return 0;
  }

  console.log("\n--- Live generation ---");
  try {
    const provider = createLlmProvider({ timeoutMs: 20_000, retries: 0 });
    const response = await provider.generate({
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      maxOutputTokens: 16,
      temperature: 0,
    });
    console.log(`provider: ${response.provider}`);
    console.log(`model: ${response.model}`);
    console.log(`finishReason: ${response.finishReason}`);
    console.log(`text: ${response.text.slice(0, 80)}`);
    console.log("\nRESULT: OK");
    return 0;
  } catch (error) {
    const message =
      error instanceof Error
        ? redactLlmSecrets(error.message)
        : redactLlmSecrets(String(error));
    console.log("\nRESULT: FAIL");
    console.log(`category: ${categoryLabel(error)}`);
    console.log(`message: ${message}`);
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
        redactLlmSecrets(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    });
}

export { main as checkLlm };
