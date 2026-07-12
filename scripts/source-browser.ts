/**
 * Owner-only Hakku browser profile connect / status / disconnect.
 * Never prints cookies, storage state, or credentials.
 */
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "../src/cli/loadEnv";
import { detectHakkuAuth } from "../src/lib/browser/hakkuAuth";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  resolveHakkuProfileDir,
  resolveHakkuProfileName,
  withPersistentPlaywright,
} from "../src/lib/browser/playwright";
import {
  hakkuProfileExists,
  readHakkuSessionMeta,
  removeOrArchiveSourceProfile,
  writeHakkuSessionMeta,
  type SourceConnectionStatus,
} from "../src/lib/browser/sessionMeta";
import { HAKKU_SWIPE_URL, probeHakkuAuth } from "../src/collectors/hakku";

const SUPPORTED = new Set(["hakku"]);

function usage(command: string): never {
  console.error(`Usage: npm run source:${command} -- <source>`);
  console.error("Supported sources: hakku");
  if (command === "disconnect") {
    console.error("Disconnect requires: --confirm");
  }
  process.exit(2);
}

function parseArgs(argv: string[]): { command: string; source: string; confirm: boolean } {
  const [command, ...rest] = argv;
  if (!command || !["connect", "status", "disconnect"].includes(command)) {
    console.error("Usage: tsx scripts/source-browser.ts <connect|status|disconnect> <source>");
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
  return { command, source, confirm };
}

async function connectHakku(): Promise<number> {
  const profileDir = resolveHakkuProfileDir();
  const profileName = resolveHakkuProfileName();
  console.log("=== Hakku source connect ===");
  console.log(`profile: ${profileName}`);
  console.log("Launching headed browser. Log in manually in the window.");
  console.log("This tool never automates passwords and never prints cookies.");
  console.log(`Open target: ${HAKKU_SWIPE_URL}`);

  const timeoutMs = 5 * 60_000;
  const pollMs = 2_500;

  try {
    await withPersistentPlaywright(
      profileDir,
      async ({ page }) => {
        await page.goto(HAKKU_SWIPE_URL, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });

        const deadline = Date.now() + timeoutMs;
        let lastStatus = "unknown";

        while (Date.now() < deadline) {
          const url = page.url();
          const title = await page.title().catch(() => "");
          const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 8_000);
          const hasPasswordField =
            (await page.locator("input[type='password']").count().catch(() => 0)) > 0;
          const hasSwipeCards =
            (await page
              .locator(
                "[data-testid='swipe-card'], article.card, .swipe-card, [class*='SwipeCard']",
              )
              .count()
              .catch(() => 0)) > 0;

          const auth = detectHakkuAuth({
            url,
            title,
            bodyText,
            hasSwipeCards,
            hasPasswordField,
          });
          lastStatus = auth;

          if (auth === "authenticated") {
            writeHakkuSessionMeta("connected");
            console.log("\nRESULT: connected");
            console.log("Authenticated Hakku session detected. Profile preserved.");
            return;
          }

          if (auth === "login_required" && lastStatus !== "login_required") {
            console.log("Waiting for manual login…");
          }

          await new Promise((resolve) => setTimeout(resolve, pollMs));
        }

        writeHakkuSessionMeta("unknown");
        console.log("\nRESULT: unknown");
        console.log(
          `Timed out waiting for authenticated state (last probe: ${lastStatus}). Profile kept for retry.`,
        );
      },
      { headless: false, timeoutMs: 30_000 },
    );
    return 0;
  } catch (error) {
    if (isPlaywrightBrowserMissingError(error)) {
      console.error(formatPlaywrightInstallHint());
      return 1;
    }
    console.error(error instanceof Error ? error.message : "Connect failed");
    return 1;
  }
}

async function statusHakku(): Promise<number> {
  console.log("=== Hakku source status ===");
  const profileName = resolveHakkuProfileName();
  console.log(`profile: ${profileName}`);

  if (!hakkuProfileExists()) {
    writeHakkuSessionMeta("profile_missing");
    console.log("status: profile missing");
    console.log("last verified: (none)");
    console.log("hint: npm run source:connect -- hakku");
    return 0;
  }

  const prior = readHakkuSessionMeta();
  let status: SourceConnectionStatus = "unknown";

  try {
    const probe = await probeHakkuAuth({
      profileDir: resolveHakkuProfileDir(),
      timeoutMs: 20_000,
      headless: true,
      captureFailure: false,
    });

    if (probe.authStatus === "authenticated") {
      status = "connected";
    } else if (probe.authStatus === "login_required") {
      status = "reconnect_required";
    } else {
      status = "unknown";
    }
    writeHakkuSessionMeta(status);
  } catch (error) {
    if (isPlaywrightBrowserMissingError(error)) {
      console.error(formatPlaywrightInstallHint());
      status = prior?.status ?? "unknown";
    } else {
      console.error(error instanceof Error ? error.message : "Status probe failed");
      status = "unknown";
      writeHakkuSessionMeta("unknown");
    }
  }

  const meta = readHakkuSessionMeta();
  const label =
    status === "reconnect_required"
      ? "reconnect required"
      : status === "profile_missing"
        ? "profile missing"
        : status;

  console.log(`status: ${label}`);
  console.log(`last verified: ${meta?.lastVerifiedAt ?? prior?.lastVerifiedAt ?? "(none)"}`);
  return 0;
}

async function disconnectHakku(confirm: boolean): Promise<number> {
  console.log("=== Hakku source disconnect ===");
  if (!confirm) {
    console.error("Refusing to remove Hakku profile without --confirm");
    console.error("Usage: npm run source:disconnect -- hakku --confirm");
    return 2;
  }

  const profileName = resolveHakkuProfileName();
  if (!hakkuProfileExists()) {
    console.log(`profile: ${profileName}`);
    console.log("status: profile missing (nothing to remove)");
    writeHakkuSessionMeta("profile_missing");
    return 0;
  }

  const result = removeOrArchiveSourceProfile(profileName, { archive: false });
  console.log(`profile: ${profileName}`);
  console.log(result.removed ? "status: disconnected (profile removed)" : "status: profile missing");
  console.log("Other source profiles were not modified.");
  return 0;
}

async function main(): Promise<number> {
  loadLocalEnv();
  const { command, source, confirm } = parseArgs(process.argv.slice(2));
  if (source !== "hakku") usage(command);

  if (command === "connect") return connectHakku();
  if (command === "status") return statusHakku();
  return disconnectHakku(confirm);
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
