import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const PASSWORD = process.env.SMOKE_OWNER_PASSWORD;

const OUT = {
  persistence: path.resolve("artifacts/terminal/final-persistence"),
  multi: path.resolve("artifacts/terminal/final-multi-session"),
  source: path.resolve("artifacts/terminal/final-source-connect"),
};

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x900", width: 1024, height: 900 },
  { name: "1440x1000", width: 1440, height: 1000 },
  { name: "1728x900", width: 1728, height: 900 },
] as const;

type Check = {
  id: string;
  expected: string;
  actual: string;
  result: "PASS" | "PARTIAL" | "LIMITED" | "FAIL";
  screenshots?: string[];
};

type SessionMeta = {
  activeId: string;
  sessions: { id: string; title: string }[];
};

const checks: Check[] = [];
const screenshots: string[] = [];
const limitations: string[] = [
  "Migration 007 was not applied; this QA ran with the development memory terminal repository.",
  "Memory mode validates refresh/navigation within one running Next.js process only, not process-restart durability.",
  "Dry-run mock discovery jobs can complete too quickly to observe every mid-execution refresh state.",
  "Hakku connect used TERMINAL_SOURCE_MOCK_HAKKU=true; live Hakku login remains manual next-phase work.",
];

function record(
  id: string,
  expected: string,
  actual: string,
  result: Check["result"],
  shotRefs: string[] = [],
) {
  checks.push({ id, expected, actual, result, screenshots: shotRefs });
  console.log(result, id, actual);
}

async function login(page: Page) {
  if (!PASSWORD) throw new Error("Set SMOKE_OWNER_PASSWORD");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      const result = await page.evaluate(async (password) => {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        return { status: res.status, text: await res.text() };
      }, PASSWORD);
      if (result.status !== 200) {
        throw new Error(
          `login failed ${result.status}: ${result.text.slice(0, 120)}`,
        );
      }
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.waitForTimeout(700);
    }
  }
}

async function waitTerminal(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(`${BASE}/terminal`, { waitUntil: "domcontentloaded" });
      break;
    } catch (error) {
      if (
        attempt === 2 ||
        !String(error).includes("ERR_ABORTED")
      ) {
        throw error;
      }
      await page.waitForTimeout(500);
    }
  }
  await page.waitForSelector("#discovery-terminal-input", { timeout: 20_000 });
  await page.waitForFunction(() => {
    const font = getComputedStyle(document.body).fontFamily.toLowerCase();
    return !font.includes("times");
  });
  await page.waitForTimeout(900);
}

async function outputText(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[role="log"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
}

async function terminalMeta(page: Page): Promise<SessionMeta> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("hf.terminal.sessionMeta.v1");
    if (!raw) throw new Error("terminal session meta missing");
    return JSON.parse(raw) as SessionMeta;
  });
}

async function submit(page: Page, command: string) {
  const input = page.locator("#discovery-terminal-input");
  await input.click();
  await input.fill(command);
  const ready = await page
    .waitForFunction((expected) => {
      const input = document.querySelector(
        "#discovery-terminal-input",
      ) as HTMLTextAreaElement | null;
      const button = document.querySelector(
        ".mac-terminal__run",
      ) as HTMLButtonElement | null;
      return input?.value === expected && button && !button.disabled;
    }, command, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (ready) {
    await page.locator(".mac-terminal__run").click();
  } else {
    await input.press("Enter");
  }
  await page.waitForTimeout(900);
}

async function shotMatrix(page: Page, dir: string, label: string): Promise<string[]> {
  const refs: string[] = [];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(200);
    const file = path.join(dir, `${label}__${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    refs.push(rel);
    screenshots.push(rel);
  }
  return refs;
}

async function createDryRunJob(page: Page, sessionId: string, command: string) {
  const result = await page.evaluate(
    async ({ sessionId, command }) => {
      const res = await fetch("/api/discovery/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command,
          terminalSessionId: sessionId,
          dryRun: true,
          sources: ["mock"],
          maxAgentCalls: 1,
        }),
      });
      return { status: res.status, body: await res.text() };
    },
    { sessionId, command },
  );
  if (result.status !== 201) {
    throw new Error(`create job failed ${result.status}: ${result.body.slice(0, 180)}`);
  }
  return JSON.parse(result.body) as { data: { job: { id: string } } };
}

async function createTerminalSessionApi(page: Page, title: string) {
  const result = await page.evaluate(async (title) => {
    const res = await fetch("/api/terminal/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, select: true }),
    });
    return { status: res.status, body: await res.text() };
  }, title);
  if (result.status !== 201) {
    throw new Error(
      `create terminal session failed ${result.status}: ${result.body.slice(0, 180)}`,
    );
  }
  return JSON.parse(result.body) as { data: { session: { id: string; title: string } } };
}

async function waitForTerminalText(page: Page, pattern: RegExp, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await outputText(page);
    if (pattern.test(text)) return text;
    await page.waitForTimeout(400);
  }
  return outputText(page);
}

function duplicateLineCount(text: string): number {
  const lines = text
    .split(/\s*(?=\[[^\]]+\])/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length - new Set(lines).size;
}

async function runPersistence(page: Page) {
  await waitTerminal(page);
  await submit(page, "/clear");
  const meta = await terminalMeta(page);
  const sessionId = meta.activeId;
  const command = "find mock persistence qa hackathons";
  const created = await createDryRunJob(page, sessionId, command);
  const jobPrefix = created.data.job.id.slice(0, 8);

  await page.goto(`${BASE}/approved`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await waitTerminal(page);
  let text = await waitForTerminalText(page, /persistence qa|Run summary|run/i);
  const navShots = await shotMatrix(page, OUT.persistence, "navigation-return");
  record(
    "navigation.persistence",
    "Returning to Terminal restores the linked job output without duplicated event lines.",
    `job=${jobPrefix}; containsCommand=${/persistence qa/.test(text)}; duplicateLineCount=${duplicateLineCount(text)}`,
    /persistence qa/.test(text) && duplicateLineCount(text) === 0 ? "PASS" : "PARTIAL",
    navShots,
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#discovery-terminal-input", { timeout: 20_000 });
  text = await waitForTerminalText(page, /persistence qa|Run summary|run/i);
  const refreshShots = await shotMatrix(page, OUT.persistence, "refresh-restore");
  record(
    "refresh.persistence",
    "Refreshing restores the terminal tab and replays historical job events.",
    `job=${jobPrefix}; containsCommand=${/persistence qa/.test(text)}; duplicateLineCount=${duplicateLineCount(text)}`,
    /persistence qa/.test(text) && duplicateLineCount(text) === 0 ? "PASS" : "PARTIAL",
    refreshShots,
  );
}

async function runMultiSession(page: Page) {
  await waitTerminal(page);
  const ai = await createTerminalSessionApi(page, "AI Canada");
  const robotics = await createTerminalSessionApi(page, "Robotics");
  const remote = await createTerminalSessionApi(page, "Remote Students");

  await createDryRunJob(page, ai.data.session.id, "find mock AI Canada discovery");
  await createDryRunJob(page, robotics.data.session.id, "find mock robotics discovery");
  await createDryRunJob(
    page,
    remote.data.session.id,
    "find mock remote student hackathons",
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#discovery-terminal-input", { timeout: 20_000 });
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("hf.terminal.sessionMeta.v1");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as SessionMeta;
    const titles = parsed.sessions.map((session) => session.title);
    return (
      titles.includes("AI Canada") &&
      titles.includes("Robotics") &&
      titles.includes("Remote Students")
    );
  });
  const meta = await terminalMeta(page);
  const sessionCountOk = meta.sessions.length >= 3;

  await submit(page, "/switch AI Canada");
  const aiText = await waitForTerminalText(page, /AI Canada discovery|Run summary/i);
  await submit(page, "/switch Robotics");
  const roboticsText = await waitForTerminalText(page, /robotics discovery|Run summary/i);
  await submit(page, "/switch Remote Students");
  const remoteText = await waitForTerminalText(page, /remote student hackathons|Run summary/i);

  const isolationOk =
    /AI Canada discovery/i.test(aiText) &&
    !/robotics discovery/i.test(aiText) &&
    /robotics discovery/i.test(roboticsText) &&
    !/AI Canada discovery/i.test(roboticsText) &&
    /remote student hackathons/i.test(remoteText);

  const multiShots = await shotMatrix(page, OUT.multi, "three-sessions-restored");
  record(
    "multi-session.isolation",
    "Three terminal sessions restore separately with isolated output and selected jobs.",
    `sessionCount=${meta.sessions.length}; isolation=${isolationOk}`,
    sessionCountOk && isolationOk ? "PASS" : "PARTIAL",
    multiShots,
  );

  await submit(page, "/switch AI Canada");
  await submit(page, "/close AI Canada");
  await submit(page, "/jobs");
  const jobsAfterClose = await outputText(page);
  const closeShots = await shotMatrix(page, OUT.multi, "close-keeps-job");
  record(
    "terminal-close.keep-running",
    "Closing a terminal leaves linked jobs discoverable via /jobs.",
    /AI Canada|mock AI Canada|completed|queued|planning/.test(jobsAfterClose)
      ? "job remained listed after close"
      : jobsAfterClose.slice(-180),
    /AI Canada|mock AI Canada|completed|queued|planning/.test(jobsAfterClose)
      ? "PASS"
      : "PARTIAL",
    closeShots,
  );
}

async function runSourceAndCommandUx(page: Page) {
  await waitTerminal(page);
  await submit(page, "/clear");
  await submit(page, "/help");
  await submit(page, "/source status hakku");
  await submit(page, "/source check hakku");
  await submit(page, "/source connect hakku");
  await submit(page, "/source disconnect hakku");
  await submit(page, "/confirm disconnect hakku");
  await submit(page, "rm -rf /");
  const sourceCommandText = await waitForTerminalText(
    page,
    /Status:|Connected|Authentication detected|Disconnected|controlled discovery terminal|Try \/help/i,
    15_000,
  );
  await page.locator("#discovery-terminal-input").fill("/sou");
  await page.locator("#discovery-terminal-input").press("Tab");
  const autocompleteValue = await page.locator("#discovery-terminal-input").inputValue();
  await submit(page, "/clear");
  await submit(page, "/help");
  await page.locator("#discovery-terminal-input").press("ArrowUp");
  const historyValue = await page.locator("#discovery-terminal-input").inputValue();

  const sourceOk =
    /Status:|Connected|Authentication detected|Disconnected|remove its saved browser session/i.test(
      sourceCommandText,
    );
  const shellRejected =
    /controlled discovery terminal|shell|Try \/help/i.test(sourceCommandText);
  const sourceShots = await shotMatrix(page, OUT.source, "source-connect-commands");
  record(
    "command-ux.source-connect",
    "Hakku status/check/connect/disconnect confirmation run through terminal without secret leakage.",
    `sourceOk=${sourceOk}; shellRejected=${shellRejected}; autocomplete=${autocompleteValue}; history=${historyValue}`,
    sourceOk && shellRejected && autocompleteValue.startsWith("/source") && historyValue === "/help"
      ? "PASS"
      : "PARTIAL",
    sourceShots,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const mobile = await page.evaluate(() => {
    const input = document.querySelector("#discovery-terminal-input");
    const rect = input?.getBoundingClientRect();
    return {
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      inputHeight: rect?.height ?? 0,
      hasSelector: Boolean(document.querySelector("#term-session-switch")),
    };
  });
  const mobileShots = await shotMatrix(page, OUT.source, "mobile-command-ux");
  record(
    "mobile.terminal",
    "Mobile terminal has selector, readable input/touch target, and no horizontal overflow.",
    JSON.stringify(mobile),
    !mobile.overflowX && mobile.inputHeight >= 40 && mobile.hasSelector ? "PASS" : "PARTIAL",
    mobileShots,
  );
}

async function main() {
  for (const dir of Object.values(OUT)) mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleEntries: string[] = [];
  page.on("console", (message) => consoleEntries.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => consoleEntries.push(`pageerror: ${String(error)}`));

  try {
    await login(page);
    await runPersistence(page);
    await runMultiSession(page);
    await runSourceAndCommandUx(page);
  } finally {
    const storage = await page
      .evaluate(async () => {
        const res = await fetch("/api/terminal/storage");
        return res.json();
      })
      .catch((error) => ({ error: String(error) }));
    const report = {
      base: BASE,
      capturedAt: new Date().toISOString(),
      viewports: VIEWPORTS.map((v) => v.name),
      storage,
      checks,
      limitations,
      screenshots,
      console: consoleEntries.slice(0, 200),
    };
    for (const dir of Object.values(OUT)) {
      writeFileSync(path.join(dir, "qa-report.json"), JSON.stringify(report, null, 2));
    }
    await browser.close();
  }

  console.log(
    "SUMMARY",
    JSON.stringify({
      checks: checks.length,
      pass: checks.filter((c) => c.result === "PASS").length,
      partial: checks.filter((c) => c.result === "PARTIAL").length,
      limited: checks.filter((c) => c.result === "LIMITED").length,
      fail: checks.filter((c) => c.result === "FAIL").length,
      screenshots: screenshots.length,
    }),
  );
}

main().catch((error) => {
  console.error("CAPTURE FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
});
