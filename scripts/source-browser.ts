/**
 * Owner-local source browser profile commands.
 * Never prints cookies, storage state, credentials, or profile paths.
 */
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "../src/cli/loadEnv";
import {
  confirmTerminalSourceDisconnect,
  connectTerminalSource,
  getTerminalSourceStatus,
  requestTerminalSourceDisconnect,
} from "../src/server/sources/terminalConnection";

const SUPPORTED = new Set(["hakku"]);

function usage(command: string): never {
  console.error(`Usage: npm run source:${command} -- <source>`);
  console.error("Supported sources: hakku");
  if (command === "disconnect") {
    console.error("Disconnect requires: --confirm");
  }
  process.exit(2);
}

function parseArgs(argv: string[]): {
  command: string;
  source: "hakku";
  confirm: boolean;
} {
  const [command, ...rest] = argv;
  if (!command || !["connect", "status", "disconnect"].includes(command)) {
    console.error(
      "Usage: tsx scripts/source-browser.ts <connect|status|disconnect> <source>",
    );
    process.exit(2);
  }

  const positional = rest.filter((arg) => !arg.startsWith("--"));
  const source = (positional[0] ?? "").trim().toLowerCase();
  const confirm = rest.includes("--confirm") || rest.includes("--yes");
  if (!source) usage(command);
  if (!SUPPORTED.has(source)) {
    console.error(`Unsupported source: ${source}`);
    usage(command);
  }
  return { command, source: "hakku", confirm };
}

async function printResult(
  result: Awaited<ReturnType<typeof connectTerminalSource>>,
): Promise<void> {
  for (const line of result.lines) {
    const prefix =
      line.level === "error"
        ? "ERROR"
        : line.level === "warning"
          ? "WARN"
          : line.level === "success"
            ? "OK"
            : "INFO";
    console.log(`${prefix}: ${line.text}`);
  }
}

async function main(): Promise<number> {
  loadLocalEnv();
  const { command, source, confirm } = parseArgs(process.argv.slice(2));
  const context = { sessionId: "cli-source-browser" };

  if (command === "status") {
    await printResult(await getTerminalSourceStatus(source, context));
    return 0;
  }

  if (command === "connect") {
    const result = await connectTerminalSource(source, context);
    await printResult(result);
    return result.lines.some((line) => line.level === "error") ? 1 : 0;
  }

  if (!confirm) {
    console.error("Refusing to remove Hakku profile without --confirm");
    console.error("Usage: npm run source:disconnect -- hakku --confirm");
    return 2;
  }

  const requestContext = { sessionId: "cli-source-browser" };
  await requestTerminalSourceDisconnect(source, requestContext);
  const result = await confirmTerminalSourceDisconnect(source, context);
  await printResult(result);
  return result.lines.some((line) => line.level === "error") ? 1 : 0;
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isDirect) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
