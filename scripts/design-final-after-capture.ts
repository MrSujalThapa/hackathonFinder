/**
 * Final-after visual audit capture (Step 11 implementation QA).
 * Does not modify production components.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SMOKE_OWNER_PASSWORD ?? "design-overhaul-pass";
const OUT = path.resolve("artifacts/design/final-after");
const FINAL_BEFORE = path.resolve("artifacts/design/final-before");

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x900", width: 1024, height: 900 },
  { name: "1440x1000", width: 1440, height: 1000 },
  { name: "1728x900", width: 1728, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
] as const;

type LayoutMetrics = {
  label: string;
  viewport: string;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  cardWidth: number | null;
  mainWidth: number | null;
  sidebarWidth: number | null;
  unusedPct: number | null;
  overflowX: boolean;
  bodyFontFamily: string;
  bodyFontSize: string;
  askVisible: boolean;
  askSnippetLeakHints: string[];
  askAnswerPreview: string | null;
  notes: string[];
};

type AcceptanceCheck = {
  id: string;
  expected: string;
  actual: string;
  pass: boolean;
  severity: "blocker" | "high" | "medium" | "low" | "info";
};

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(450);
}

async function shot(page: Page, vp: (typeof VIEWPORTS)[number], label: string) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(180);
  const file = path.join(OUT, `${label}__${vp.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("saved", label, vp.name);
  return file;
}

async function measure(page: Page, label: string, viewport: string): Promise<LayoutMetrics> {
  return page.evaluate(
    ({ label: l, viewport: v }) => {
      const clientWidth = document.documentElement.clientWidth;
      const clientHeight = document.documentElement.clientHeight;
      const scrollWidth = document.documentElement.scrollWidth;

      const article = document.querySelector("article");
      const main =
        document.querySelector("main") ||
        document.querySelector('[role="main"]') ||
        document.querySelector(".workspace-main") ||
        document.querySelector("[data-workspace-main]");
      const aside =
        document.querySelector("aside") ||
        document.querySelector("nav[aria-label]") ||
        document.querySelector("[data-sidebar]") ||
        document.querySelector("nav");

      const cardWidth = article ? Math.round(article.getBoundingClientRect().width) : null;
      const mainWidth = main ? Math.round(main.getBoundingClientRect().width) : null;
      const sidebarWidth = aside ? Math.round(aside.getBoundingClientRect().width) : null;

      let unusedPct: number | null = null;
      if (cardWidth != null && mainWidth != null && clientWidth > 0) {
        unusedPct = Math.round(((mainWidth - cardWidth) / clientWidth) * 1000) / 10;
      } else if (cardWidth != null && clientWidth > 0) {
        unusedPct = Math.round(((clientWidth - cardWidth) / clientWidth) * 1000) / 10;
      }

      const bodyStyle = window.getComputedStyle(document.body);
      const notes: string[] = [];
      if (!article) notes.push("no-article-card");
      if (!main) notes.push("no-main");
      if (!aside) notes.push("no-aside");

      const askEl =
        document.querySelector('[aria-label="Ask a question about this candidate"]') ||
        document.querySelector("textarea");
      const askVisible = Boolean(
        askEl &&
          (() => {
            const s = window.getComputedStyle(askEl);
            const r = askEl.getBoundingClientRect();
            return s.display !== "none" && s.visibility !== "hidden" && r.width > 2 && r.height > 2;
          })(),
      );

      const leakPatterns =
        /https?:\/\/\S+|snippet|raw source|authority:\s*\d+|evidence\[|```|pipe-delimited|\|\s*[A-Z]{2,}/i;
      const askSnippetLeakHints: string[] = [];
      let askAnswerPreview: string | null = null;
      const answerBlocks = Array.from(
        document.querySelectorAll("[data-ask-answer], .ask-answer, [role='article'], section, aside, main"),
      );
      for (const el of answerBlocks) {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!t || t.length < 40) continue;
        if (/Should I|recommend|decision|Ask|sources? cited/i.test(t) || leakPatterns.test(t)) {
          if (!askAnswerPreview && /recommend|Should I|trade-?off|next step|citation|date|deadline/i.test(t)) {
            askAnswerPreview = t.slice(0, 280);
          }
          if (leakPatterns.test(t)) {
            askSnippetLeakHints.push(t.slice(0, 160));
          }
        }
      }

      return {
        label: l,
        viewport: v,
        clientWidth,
        clientHeight,
        scrollWidth,
        cardWidth,
        mainWidth,
        sidebarWidth,
        unusedPct,
        overflowX: scrollWidth > clientWidth + 1,
        bodyFontFamily: bodyStyle.fontFamily,
        bodyFontSize: bodyStyle.fontSize,
        askVisible,
        askSnippetLeakHints: askSnippetLeakHints.slice(0, 5),
        askAnswerPreview,
        notes,
      };
    },
    { label, viewport },
  );
}

async function login(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
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
      await page.goto(`${BASE}/queue`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await settle(page);
      if (!page.url().includes("/queue")) throw new Error(`expected /queue got ${page.url()}`);
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      console.log("LOGIN_RETRY", attempt + 1, String(err).slice(0, 140));
      await page.waitForTimeout(700);
    }
  }
  const reset = await page.evaluate(async () => {
    const res = await fetch("/api/dev/reset-mock", { method: "POST" });
    return { status: res.status, body: await res.text() };
  });
  console.log("MOCK_RESET", reset.status, reset.body.slice(0, 120));
  await page.goto(`${BASE}/queue`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);
}

async function firstQueueCandidateId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const res1 = await fetch("/api/candidates?status=NEEDS_REVIEW&limit=5&sort=score");
    if (res1.ok) {
      const json1 = (await res1.json()) as { data?: { candidates?: Array<{ id: string }> } };
      const id1 = json1?.data?.candidates?.[0]?.id;
      if (id1) return id1;
    }
    const res2 = await fetch("/api/candidates?status=NEW&limit=5&sort=score");
    if (!res2.ok) return null;
    const json2 = (await res2.json()) as { data?: { candidates?: Array<{ id: string }> } };
    return json2?.data?.candidates?.[0]?.id ?? null;
  });
}

async function openFirstCandidate(page: Page): Promise<boolean> {
  await page.goto(`${BASE}/queue`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);

  const article = page.getByRole("article").first();
  if (await article.count()) {
    await article.click({ position: { x: 40, y: 40 } }).catch(() => undefined);
    await page.waitForURL(/\/candidate\//, { timeout: 8_000, waitUntil: "domcontentloaded" }).catch(() => undefined);
    await settle(page);
  }

  if (!page.url().includes("/candidate/")) {
    await article.focus().catch(() => undefined);
    await page.keyboard.press("Enter").catch(() => undefined);
    await page.waitForURL(/\/candidate\//, { timeout: 8_000, waitUntil: "domcontentloaded" }).catch(() => undefined);
    await settle(page);
  }

  if (!page.url().includes("/candidate/")) {
    const id = await firstQueueCandidateId(page);
    if (id) {
      await page.goto(`${BASE}/candidate/${id}`, { waitUntil: "domcontentloaded" });
      await settle(page);
    }
  }

  if (!page.url().includes("/candidate/")) return false;

  const ask = page.getByLabel("Ask a question about this candidate");
  const loaded = await ask
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!loaded) {
    const body = await page.locator("body").innerText().catch(() => "");
    console.log("DETAIL_LOAD_FAIL", body.replace(/\s+/g, " ").slice(0, 240));
    return false;
  }
  await settle(page);
  return true;
}

/** Visible-only queue chrome checks (ignore closed menu items). */
async function inspectQueueChrome(page: Page): Promise<{
  moreDetailsVisible: boolean;
  keyboardBanner: boolean;
  permanentKeyboardLine: boolean;
  visibleActionButtons: string[];
  bodySnippet: string;
}> {
  // Keep evaluate body free of nested function declarations — tsx injects __name
  // helpers that break Playwright serialization.
  return page.evaluate(`(() => {
    const vis = (el) => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.01 && r.width > 1 && r.height > 1;
    };
    const bodyText = (document.body.innerText || "").replace(/\\s+/g, " ");
    const moreDetailsVisible = Array.from(document.querySelectorAll("button, a, [role='button']")).some((el) => {
      const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
      return /more details/i.test(t) && vis(el);
    });
    const keyboardBanner = Array.from(document.querySelectorAll("p, div, span, banner, [role='status']")).some((el) => {
      if (!vis(el)) return false;
      const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
      if (!/^Keyboard\\s*:/i.test(t)) return false;
      if (el.closest("[role='dialog'], [hidden], details:not([open])")) return false;
      return true;
    });
    const permanentKeyboardLine = /Keyboard\\s*:\\s*(←|Left|Reject)/i.test(bodyText);
    const actionLabels = ["Approve", "Reject", "Save"];
    const visibleActionButtons = actionLabels.filter((label) =>
      Array.from(document.querySelectorAll("button, a, [role='menuitem'], [role='button']")).some((el) => {
        const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
        if (t !== label && !(new RegExp("^" + label + "\\\\b", "i")).test(t)) return false;
        if (!vis(el)) return false;
        const menu = el.closest("[role='menu'], [data-radix-menu-content], [data-state='closed']");
        if (menu && !vis(menu)) return false;
        if (el.closest("[hidden], [aria-hidden='true']")) return false;
        return true;
      }),
    );
    return {
      moreDetailsVisible,
      keyboardBanner,
      permanentKeyboardLine,
      visibleActionButtons,
      bodySnippet: bodyText.slice(0, 400),
    };
  })()`) as Promise<{
    moreDetailsVisible: boolean;
    keyboardBanner: boolean;
    permanentKeyboardLine: boolean;
    visibleActionButtons: string[];
    bodySnippet: string;
  }>;
}

async function askQuestion(
  page: Page,
  question: string,
  label: string,
): Promise<{ ok: boolean; preview: string; status?: number }> {
  const ask = page.getByLabel("Ask a question about this candidate");
  if (!(await ask.count())) return { ok: false, preview: "ask-missing" };

  let status: number | undefined;
  const responsePromise = page
    .waitForResponse(
      (res) => res.url().includes("/ask") && res.request().method() === "POST",
      { timeout: 45_000 },
    )
    .then((res) => {
      status = res.status();
      return res;
    })
    .catch(() => null);

  await ask.scrollIntoViewIfNeeded().catch(() => undefined);
  await ask.fill(question);
  await page.keyboard.press("Enter");
  const res = await responsePromise;
  await page.waitForTimeout(1200);

  const body = await page.locator("body").innerText().catch(() => "");
  const preview = body.replace(/\s+/g, " ").slice(0, 700);
  const ok = Boolean(res && status && status >= 200 && status < 300);
  console.log("ASK", label, "status", status ?? "none", "ok", ok);
  return { ok, preview, status };
}

function maybeCopyKeyShotsToFinalBefore(screenshots: string[]) {
  mkdirSync(FINAL_BEFORE, { recursive: true });
  const existing = existsSync(FINAL_BEFORE)
    ? readdirSync(FINAL_BEFORE).filter((f) => f.endsWith(".png"))
    : [];
  if (existing.length > 0) {
    console.log("FINAL_BEFORE_SKIP", "already has", existing.length, "pngs; corrective-before is baseline");
    return { copied: false, reason: "not-empty" as const };
  }

  // Key shots only: queue/detail/ask/settings at laptop + wide
  const keyRe =
    /^(queue|candidate-detail|ask-section|ask-factual|ask-decision|settings)__(1440x1000|1920x1080)\.png$/;
  let n = 0;
  for (const abs of screenshots) {
    const base = path.basename(abs);
    if (!keyRe.test(base)) continue;
    copyFileSync(abs, path.join(FINAL_BEFORE, base));
    n += 1;
  }
  console.log("FINAL_BEFORE_COPIED", n, "key after shots (folder was empty)");
  return { copied: true, reason: "was-empty" as const, count: n };
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const consoleLogs: Array<{ type: string; text: string }> = [];
  const failedRequests: Array<{ url: string; status: number }> = [];
  const screenshots: string[] = [];
  const metrics: LayoutMetrics[] = [];
  const notes: string[] = [];
  const checks: AcceptanceCheck[] = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleLogs.push({ type: msg.type(), text: msg.text() });
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && !res.url().includes("_next")) {
      failedRequests.push({ url: res.url(), status: res.status() });
    }
  });

  try {
    await login(page);

    // Queue chrome acceptance at 1440 first
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/queue`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await settle(page);
    const chrome = await inspectQueueChrome(page);
    notes.push(`queue-chrome: ${JSON.stringify(chrome)}`);

    checks.push({
      id: "no-more-details",
      expected: "No visible More details button on queue",
      actual: chrome.moreDetailsVisible ? "More details visible" : "Absent",
      pass: !chrome.moreDetailsVisible,
      severity: "blocker",
    });
    checks.push({
      id: "no-keyboard-banner",
      expected: "No permanent Keyboard: banner on queue",
      actual:
        chrome.keyboardBanner || chrome.permanentKeyboardLine
          ? "Keyboard banner/line present"
          : "Absent (shortcuts behind ? only)",
      pass: !chrome.keyboardBanner && !chrome.permanentKeyboardLine,
      severity: "blocker",
    });
    checks.push({
      id: "no-permanent-action-row",
      expected: "No visible Approve/Reject/Save row on queue",
      actual:
        chrome.visibleActionButtons.length === 0
          ? "Absent"
          : `Visible: ${chrome.visibleActionButtons.join(", ")}`,
      pass: chrome.visibleActionButtons.length === 0,
      severity: "blocker",
    });

    for (const route of ["queue", "approved", "rejected", "saved", "settings"] as const) {
      for (const vp of VIEWPORTS) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await page.goto(`${BASE}/${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await settle(page);
            break;
          } catch (err) {
            if (attempt === 2) throw err;
            await page.waitForTimeout(800);
          }
        }
        screenshots.push(await shot(page, vp, route));
        metrics.push(await measure(page, route, vp.name));
      }
    }

    const queue1440 = metrics.find((m) => m.label === "queue" && m.viewport === "1440x1000");
    const queue1920 = metrics.find((m) => m.label === "queue" && m.viewport === "1920x1080");
    const card1440 = queue1440?.cardWidth ?? null;
    const card1920 = queue1920?.cardWidth ?? null;
    notes.push(`cardWidth@1440=${card1440}`);
    notes.push(`cardWidth@1920=${card1920}`);

    checks.push({
      id: "card-width-1440",
      expected: "queue cardWidth ≥ 600 at 1440×1000",
      actual: card1440 == null ? "null (no article)" : String(card1440),
      pass: card1440 != null && card1440 >= 600,
      severity: "blocker",
    });
    checks.push({
      id: "card-width-1920",
      expected: "queue cardWidth measured at 1920×1080",
      actual: card1920 == null ? "null (no article)" : String(card1920),
      pass: card1920 != null && card1920 > 0,
      severity: "info",
    });

    const overflowQueue = metrics.filter((m) => m.label === "queue" && m.overflowX);
    checks.push({
      id: "no-horizontal-overflow-queue",
      expected: "No horizontal overflow on queue viewports",
      actual: overflowQueue.length === 0 ? "None" : overflowQueue.map((m) => m.viewport).join(", "),
      pass: overflowQueue.length === 0,
      severity: "high",
    });

    const opened = await openFirstCandidate(page);
    notes.push(opened ? `detail-open: ${page.url()}` : "detail-open: failed");
    checks.push({
      id: "detail-reachable",
      expected: "Queue opens candidate detail with Ask composer",
      actual: opened ? page.url() : "failed",
      pass: opened,
      severity: "blocker",
    });

    if (opened) {
      for (const vp of VIEWPORTS) {
        screenshots.push(await shot(page, vp, "candidate-detail"));
        metrics.push(await measure(page, "candidate-detail", vp.name));

        const ask = page.getByLabel("Ask a question about this candidate");
        if (await ask.count()) {
          await ask.scrollIntoViewIfNeeded().catch(() => undefined);
          await page.waitForTimeout(200);
          screenshots.push(await shot(page, vp, "ask"));
          metrics.push(await measure(page, "ask", vp.name));
        }
      }

      await page.setViewportSize({ width: 1440, height: 1000 });
      await settle(page);

      const factual = await askQuestion(page, "date?", "factual");
      notes.push(`ask-factual: status=${factual.status ?? "n/a"} ok=${factual.ok}`);
      notes.push(`ask-factual-preview: ${factual.preview.slice(0, 400)}`);
      screenshots.push(await shot(page, VIEWPORTS[4], "ask-factual"));
      metrics.push(await measure(page, "ask-factual", "1440x1000"));

      const decision = await askQuestion(page, "Should I do this hackathon?", "decision");
      notes.push(`ask-decision: status=${decision.status ?? "n/a"} ok=${decision.ok}`);
      notes.push(`ask-decision-preview: ${decision.preview.slice(0, 400)}`);
      screenshots.push(await shot(page, VIEWPORTS[4], "ask-decision"));
      metrics.push(await measure(page, "ask-decision", "1440x1000"));

      const leakHints = [
        ...metrics.filter((m) => m.label.startsWith("ask")).flatMap((m) => m.askSnippetLeakHints),
      ];
      checks.push({
        id: "ask-factual",
        expected: "POST ask date? returns answer without raw snippet dump",
        actual: factual.ok
          ? `HTTP ${factual.status}; preview=${factual.preview.slice(0, 120)}`
          : `failed status=${factual.status ?? "n/a"}`,
        pass: factual.ok && leakHints.length === 0,
        severity: "high",
      });
      checks.push({
        id: "ask-decision",
        expected: "POST ask Should I do this hackathon? returns structured answer",
        actual: decision.ok
          ? `HTTP ${decision.status}; preview=${decision.preview.slice(0, 120)}`
          : `failed status=${decision.status ?? "n/a"}`,
        pass: decision.ok,
        severity: "high",
      });
    }

    const productErrors = consoleLogs.filter(
      (c) => !/Download the React DevTools|Fast Refresh|\[HMR\]/i.test(c.text),
    );
    checks.push({
      id: "console-clean",
      expected: "No material product console errors",
      actual: productErrors.length === 0 ? "Clean" : productErrors.slice(0, 3).map((c) => c.text).join(" | "),
      pass: productErrors.length === 0,
      severity: "medium",
    });

    const beforeCopy = maybeCopyKeyShotsToFinalBefore(screenshots);

    const report = {
      step: "final-after",
      capturedAt: new Date().toISOString(),
      baseUrl: BASE,
      viewports: VIEWPORTS,
      screenshots: screenshots.map((s) => path.relative(process.cwd(), s).replace(/\\/g, "/")),
      metrics,
      notes,
      checks,
      cardWidths: {
        "1440x1000": card1440,
        "1920x1080": card1920,
      },
      finalBeforeCopy: beforeCopy,
      consoleLogs: consoleLogs.slice(0, 40),
      failedRequests: failedRequests.slice(0, 80),
    };
    writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(report, null, 2));
    writeFileSync(path.join(OUT, "console.json"), JSON.stringify({ consoleLogs, failedRequests }, null, 2));

    console.log("CARD_WIDTHS", JSON.stringify(report.cardWidths));
    console.log(
      "CHECKS",
      checks.map((c) => `${c.id}:${c.pass ? "PASS" : "FAIL"}`).join(" "),
    );
    console.log("METRICS_OK", metrics.length, "screenshots", screenshots.length);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("FINAL_AFTER_CAPTURE_FAIL", e);
  process.exit(1);
});
