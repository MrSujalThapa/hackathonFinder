/**
 * Step 16 Terminal + Settings Sources visual QA capture.
 *
 * Auth: APP_PASSWORD (same flow as smoke:prod / design-after-capture).
 * Prefer API login for reliability under Fast Refresh.
 *
 * Usage (server already running):
 *   npx tsx scripts/terminal-source-qa-capture.ts
 */
import { chromium, type ConsoleMessage, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "../src/cli/loadEnv";

loadLocalEnv();
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.APP_PASSWORD;
const TERM_OUT = path.resolve("artifacts/terminal");
const SRC_OUT = path.resolve("artifacts/sources");

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x900", width: 1024, height: 900 },
  { name: "1440x1000", width: 1440, height: 1000 },
  { name: "1728x900", width: 1728, height: 900 },
] as const;

type Check = { id: string; pass: boolean; detail: string };

type ConsoleEntry = {
  type: string;
  text: string;
  location?: string;
  when: string;
};

const consoleEntries: ConsoleEntry[] = [];
const checks: Check[] = [];
const blockers: string[] = [];
const screenshotIndex: string[] = [];

const LEAK_RE =
  /(?:\.data[\\/]browser-profiles|APP_OWNER|APP_SESSION|SUPABASE_SERVICE|sk-proj-|Bearer |cookie=|Set-Cookie|private_key|GOOGLE_SERVICE_ACCOUNT)/i;

function record(id: string, pass: boolean, detail: string) {
  checks.push({ id, pass, detail });
  console.log(pass ? "PASS" : "FAIL", id, detail);
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(450);
}

async function shot(
  page: Page,
  outDir: string,
  vp: (typeof VIEWPORTS)[number],
  label: string,
) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(180);
  const file = path.join(outDir, `${label}__${vp.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
  screenshotIndex.push(rel);
  console.log("saved", rel);
}

function attachConsole(page: Page) {
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    consoleEntries.push({
      type: msg.type(),
      text: text.slice(0, 500),
      location: msg.location()?.url,
      when: new Date().toISOString(),
    });
  });
  page.on("pageerror", (err) => {
    consoleEntries.push({
      type: "pageerror",
      text: String(err).slice(0, 500),
      when: new Date().toISOString(),
    });
  });
}

async function login(page: Page) {
  if (!PASSWORD) throw new Error("Set APP_PASSWORD");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(`${BASE}/login`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await settle(page);
      const api = await page.evaluate(async (password) => {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        return { status: res.status, body: await res.text() };
      }, PASSWORD);
      console.log("API_LOGIN", api.status, api.body.slice(0, 80));
      if (api.status !== 200) throw new Error(`login status ${api.status}`);
      await page.goto(`${BASE}/queue`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await settle(page);
      if (!page.url().includes("/queue")) {
        throw new Error(`expected /queue got ${page.url()}`);
      }
      record("auth.login", true, "API login → /queue");
      return;
    } catch (err) {
      if (attempt === 2) {
        record("auth.login", false, String(err).slice(0, 200));
        throw err;
      }
      console.log("LOGIN_RETRY", attempt + 1, String(err).slice(0, 140));
      await page.waitForTimeout(700);
    }
  }
}

async function waitForHydration(page: Page) {
  await page.waitForSelector("#discovery-terminal-input", { timeout: 20_000 });
  // Unstyled SSR fallback uses Times/serif; wait until app CSS applied.
  for (let i = 0; i < 40; i += 1) {
    const ok = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const font = body.fontFamily.toLowerCase();
      const bg = body.backgroundColor;
      const serifOnly = font.includes("times") && !font.includes("mono");
      const whiteBg = bg === "rgb(255, 255, 255)" || bg === "rgba(0, 0, 0, 0)";
      return !serifOnly && !whiteBg;
    });
    if (ok) return;
    await page.waitForTimeout(250);
  }
  console.log("WARN hydration/styles still look default after wait");
}

async function submitCommand(page: Page, command: string) {
  const input = page.locator("#discovery-terminal-input");
  await input.waitFor({ timeout: 10_000 });
  await input.click();
  await input.fill(command);
  // Prefer Run button — Enter can be flaky before hydration settles.
  const run = page.getByRole("button", { name: /^Run$/i });
  if ((await run.count()) > 0 && (await run.isEnabled())) {
    await run.click();
  } else {
    await input.press("Enter");
  }
  await page.waitForTimeout(900);
}

async function terminalOutputText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const output = document.querySelector('[role="log"]');
    const root = output ?? document.body;
    return (root.textContent || "").replace(/\s+/g, " ").trim();
  });
}

async function terminalBodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
}

async function captureTerminalMatrix(page: Page, label: string) {
  for (const vp of VIEWPORTS) {
    await shot(page, TERM_OUT, vp, label);
  }
}

async function captureSourcesMatrix(page: Page, label: string) {
  for (const vp of VIEWPORTS) {
    await shot(page, SRC_OUT, vp, label);
  }
}

async function runTerminalChecks(page: Page) {
  await page.goto(`${BASE}/terminal`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await settle(page);
  await waitForHydration(page);

  const emptyText = await terminalOutputText(page);
  const hasEmpty = /Discovery console ready/i.test(emptyText);
  const hasInput = (await page.locator("#discovery-terminal-input").count()) > 0;
  record(
    "terminal.empty_state",
    hasEmpty && hasInput,
    hasEmpty && hasInput
      ? "Ready banner + command input present"
      : `empty=${hasEmpty} input=${hasInput}`,
  );
  await captureTerminalMatrix(page, "empty");

  // Focus input (command input state)
  await page.locator("#discovery-terminal-input").click();
  await page.locator("#discovery-terminal-input").fill("");
  await captureTerminalMatrix(page, "input-focus");
  record("terminal.command_input", true, "#discovery-terminal-input focusable");

  // /help — require multiple slash commands in the log region
  await submitCommand(page, "/help");
  let log = await terminalOutputText(page);
  const helpOk =
    /\/find\b/i.test(log) &&
    /\/sources\b/i.test(log) &&
    /\/status\b/i.test(log) &&
    /\/history\b/i.test(log);
  record("terminal.help", helpOk, helpOk ? "/help listed commands" : log.slice(0, 220));
  await captureTerminalMatrix(page, "help");

  // /sources — health fetch can take several seconds (live checks)
  await submitCommand(page, "/sources");
  try {
    await page.waitForFunction(
      () => {
        const t = document.querySelector('[role="log"]')?.textContent || "";
        return /\[mlh\]/i.test(t) && /\[hakku\]/i.test(t);
      },
      { timeout: 25_000 },
    );
  } catch {
    console.log("WARN /sources health lines not fully loaded before screenshot");
  }
  log = await terminalOutputText(page);
  const sourcesOk =
    /\[mlh\]/i.test(log) &&
    /\[devpost\]/i.test(log) &&
    /\[luma\]/i.test(log) &&
    /\[hakku\]/i.test(log);
  record(
    "terminal.sources",
    sourcesOk,
    sourcesOk ? "/sources rendered health lines" : log.slice(-220),
  );
  await captureTerminalMatrix(page, "sources");

  // /status
  await submitCommand(page, "/status");
  await page.waitForTimeout(800);
  log = await terminalOutputText(page);
  const statusOk =
    /no active|idle|queued|running|completed|failed|cancelled|latest job|status/i.test(
      log,
    );
  record(
    "terminal.status",
    statusOk,
    statusOk ? "/status produced output" : log.slice(-220),
  );
  await captureTerminalMatrix(page, "status");

  // /history
  await submitCommand(page, "/history");
  await page.waitForTimeout(1200);
  log = await terminalOutputText(page);
  const historyOk =
    /no (?:recent )?jobs|job\b|completed|failed|queued|running|cancelled|empty history|history/i.test(
      log,
    );
  record(
    "terminal.history",
    historyOk,
    historyOk ? "/history produced output" : log.slice(-220),
  );
  await captureTerminalMatrix(page, "history");

  // Invalid shell-like command
  await submitCommand(page, "rm -rf /");
  await page.waitForTimeout(500);
  log = await terminalOutputText(page);
  const rejectOk =
    /only accepts discovery commands|not shell or system commands|Try \/help/i.test(
      log,
    );
  record(
    "terminal.shell_reject",
    rejectOk,
    rejectOk ? "shell-like input rejected" : log.slice(-220),
  );
  await captureTerminalMatrix(page, "shell-reject");

  // Mobile layout notes at 390
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const mobileMetrics = await page.evaluate(() => {
    const input = document.querySelector(
      "#discovery-terminal-input",
    ) as HTMLTextAreaElement | null;
    const inputRect = input?.getBoundingClientRect();
    const showBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      /^Show$/i.test((b.textContent || "").trim()),
    );
    return {
      overflowX:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      inputMinHeight: inputRect?.height ?? 0,
      inputBottom: inputRect?.bottom ?? 0,
      viewportHeight: window.innerHeight,
      showRailButton: Boolean(showBtn),
      bodyHasProfilePath: /\.data[\\/]browser-profiles/i.test(
        document.body.innerText,
      ),
      bodyHasCookieBlob: /(?:cookie|sessionid|playwright)/i.test(
        document.body.innerText,
      ),
    };
  });
  record(
    "terminal.mobile_layout",
    !mobileMetrics.overflowX && mobileMetrics.inputMinHeight >= 40,
    `overflowX=${mobileMetrics.overflowX} inputH=${mobileMetrics.inputMinHeight} showRail=${mobileMetrics.showRailButton} inputBottom=${Math.round(mobileMetrics.inputBottom)}/${mobileMetrics.viewportHeight}`,
  );
  record(
    "terminal.no_secret_leak_dom",
    !mobileMetrics.bodyHasProfilePath,
    mobileMetrics.bodyHasProfilePath
      ? "profile path visible in DOM"
      : "no browser profile paths in body text",
  );

  // Discovery dry-run-ish via API (UI does not expose dryRun flag)
  const findProbe = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/discovery/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "find upcoming AI hackathons in Toronto",
          dryRun: true,
          maxAgentCalls: 1,
          sources: ["mlh"],
        }),
      });
      const text = await res.text();
      return {
        status: res.status,
        body: text.slice(0, 600),
        ok: res.ok,
      };
    } catch (err) {
      return {
        status: 0,
        body: String(err).slice(0, 300),
        ok: false,
      };
    }
  });

  if (findProbe.ok) {
    record(
      "terminal.discovery_dry_run",
      true,
      `POST /api/discovery/jobs dryRun → ${findProbe.status}`,
    );
    await page.goto(`${BASE}/terminal`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await settle(page);
    await waitForHydration(page);
    await submitCommand(page, "/status");
    await page.waitForTimeout(800);
    await captureTerminalMatrix(page, "find-dryrun-status");
    await submitCommand(page, "/history");
    await page.waitForTimeout(800);
    await captureTerminalMatrix(page, "find-dryrun-history");

    // Best-effort cancel if a job id is present
    try {
      const parsed = JSON.parse(findProbe.body) as {
        data?: { job?: { id?: string } };
      };
      const jobId = parsed.data?.job?.id;
      if (jobId) {
        await page.evaluate(async (id) => {
          await fetch(`/api/discovery/jobs/${id}/cancel`, { method: "POST" });
        }, jobId);
      }
    } catch {
      // ignore parse/cancel failures
    }
  } else {
    record(
      "terminal.discovery_dry_run",
      false,
      `blocked: ${findProbe.status} ${findProbe.body.slice(0, 220)}`,
    );
    blockers.push(
      `Discovery dry-run POST failed (${findProbe.status}): ${findProbe.body.slice(0, 180)}`,
    );
    await captureTerminalMatrix(page, "find-blocked");
  }

  // Soft UI /find attempt — stay on same page to avoid Fast Refresh wiping console
  await submitCommand(page, "/clear");
  await page.waitForTimeout(400);
  await submitCommand(page, "/find upcoming Toronto hackathons");
  try {
    await page.waitForFunction(
      () => {
        const t = document.querySelector('[role="log"]')?.textContent || "";
        return /queued|running|planning|failed|error|already active|job|started|\[error\]/i.test(
          t,
        );
      },
      { timeout: 12_000 },
    );
  } catch {
    console.log("WARN /find response not detected within timeout");
  }
  log = await terminalOutputText(page);
  const uiFindResponded =
    /queued|running|planning|failed|error|already active|dry|job|started|\[error\]/i.test(
      log,
    );
  record(
    "terminal.ui_find_attempt",
    uiFindResponded,
    uiFindResponded
      ? "UI /find produced a response line"
      : "no clear find response (see blockers)",
  );
  await captureTerminalMatrix(page, "ui-find");
}

async function runSourcesChecks(page: Page) {
  await page.goto(`${BASE}/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await settle(page);
  // Settings is server-rendered; wait for Sources heading + non-default styles.
  await page
    .getByRole("heading", { name: "Sources", exact: true })
    .waitFor({ timeout: 15_000 });
  for (let i = 0; i < 30; i += 1) {
    const ok = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const font = body.fontFamily.toLowerCase();
      const bg = body.backgroundColor;
      return !(font.includes("times") && !font.includes("mono")) &&
        bg !== "rgb(255, 255, 255)" &&
        bg !== "rgba(0, 0, 0, 0)";
    });
    if (ok) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(600);

  const body = await terminalBodyText(page);
  const required = ["MLH", "Web", "HackList", "Devpost", "Luma", "Hakku"];
  const missing = required.filter((name) => !body.includes(name));
  record(
    "sources.all_cards",
    missing.length === 0,
    missing.length === 0
      ? "All six source cards present"
      : `missing: ${missing.join(", ")}`,
  );

  const hakkuConnect = /npm run source:connect -- hakku/i.test(body);
  record(
    "sources.hakku_connect",
    hakkuConnect,
    hakkuConnect
      ? "Hakku connect instructions present"
      : "Hakku connect copy missing",
  );

  const lumaPublic = /Public mode is supported/i.test(body);
  record(
    "sources.luma_public",
    lumaPublic,
    lumaPublic
      ? "Luma public-mode note present"
      : "Luma public-mode copy missing",
  );

  const statusWords =
    /healthy|degraded|auth required|unconfigured|disabled|failed/i.test(body);
  record(
    "sources.status_display",
    statusWords,
    statusWords ? "Status labels visible" : "no status labels found",
  );

  const noProfileLeak = !/\.data[\\/]browser-profiles/i.test(body);
  const noCookieLeak = !/(?:Set-Cookie|sessionid=)/i.test(body);
  record(
    "sources.no_secret_leak",
    noProfileLeak && noCookieLeak,
    noProfileLeak && noCookieLeak
      ? "no profile paths / cookies in settings DOM"
      : "possible secret leakage in settings DOM",
  );

  // Expand Hakku / Luma into view on mobile by scrolling to them
  await page
    .getByRole("heading", { name: "Hakku", exact: true })
    .scrollIntoViewIfNeeded()
    .catch(() => undefined);
  await captureSourcesMatrix(page, "settings-sources");

  await page
    .getByRole("heading", { name: "Luma", exact: true })
    .scrollIntoViewIfNeeded()
    .catch(() => undefined);
  await shot(page, SRC_OUT, VIEWPORTS[0], "luma-card-phone");
  await shot(page, SRC_OUT, VIEWPORTS[4], "luma-card-laptop");

  await page
    .getByRole("heading", { name: "Hakku", exact: true })
    .scrollIntoViewIfNeeded()
    .catch(() => undefined);
  await shot(page, SRC_OUT, VIEWPORTS[0], "hakku-card-phone");
  await shot(page, SRC_OUT, VIEWPORTS[4], "hakku-card-laptop");
}

async function main() {
  mkdirSync(TERM_OUT, { recursive: true });
  mkdirSync(SRC_OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  attachConsole(page);

  try {
    await login(page);
    await runTerminalChecks(page);
    await runSourcesChecks(page);
  } finally {
    const errorLike = consoleEntries.filter((e) => {
      if (e.type === "pageerror") {
        return !/Hydration failed|didn't match the client/i.test(e.text);
      }
      if (e.type === "error") {
        if (/webpack\.hot-update\.json|Failed to load resource.*404/i.test(e.text)) {
          return false;
        }
        if (/Hydration failed|didn't match the client/i.test(e.text)) return false;
        return true;
      }
      return e.type === "warning" && LEAK_RE.test(e.text);
    });
    const leaks = consoleEntries.filter((e) => LEAK_RE.test(e.text));
    record(
      "console.no_errors",
      errorLike.length === 0,
      errorLike.length === 0
        ? "no console errors/pageerrors"
        : `${errorLike.length} error-like entries`,
    );
    record(
      "console.no_secret_leak",
      leaks.length === 0,
      leaks.length === 0
        ? "no secret-like console text"
        : `${leaks.length} leak-pattern matches`,
    );

    const report = {
      base: BASE,
      capturedAt: new Date().toISOString(),
      viewports: VIEWPORTS.map((v) => v.name),
      checks,
      blockers,
      screenshots: screenshotIndex,
      console: consoleEntries.slice(0, 200),
      consoleErrorCount: errorLike.length,
      consoleLeakCount: leaks.length,
    };

    writeFileSync(
      path.join(TERM_OUT, "qa-report.json"),
      JSON.stringify(report, null, 2),
    );
    writeFileSync(
      path.join(SRC_OUT, "qa-report.json"),
      JSON.stringify(
        {
          ...report,
          focus: "settings-sources",
          checks: checks.filter((c) => c.id.startsWith("sources") || c.id.startsWith("auth") || c.id.startsWith("console")),
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(TERM_OUT, "console.json"),
      JSON.stringify(consoleEntries, null, 2),
    );
    writeFileSync(
      path.join(SRC_OUT, "console.json"),
      JSON.stringify(consoleEntries, null, 2),
    );

    await browser.close();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log("\nSUMMARY", {
    pass: checks.filter((c) => c.pass).length,
    fail: failed.length,
    blockers: blockers.length,
    screenshots: screenshotIndex.length,
  });
  if (failed.length) {
    console.log(
      "FAILED",
      failed.map((f) => `${f.id}: ${f.detail}`).join(" | "),
    );
  }
}

main().catch((error) => {
  console.error(
    "CAPTURE FAIL",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
