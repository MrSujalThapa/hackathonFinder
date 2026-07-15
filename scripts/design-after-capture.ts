/**
 * Step 15 after-implementation visual QA capture.
 * Viewports: phone, tablet, laptop, wide desktop.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "../src/cli/loadEnv";

loadLocalEnv();
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.APP_PASSWORD;
const OUT = path.resolve("artifacts/design/after");
const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x1000", width: 1440, height: 1000 },
  { name: "1728x900", width: 1728, height: 900 },
] as const;

type CheckResult = {
  id: string;
  pass: boolean;
  detail: string;
};

type Metrics = {
  label: string;
  viewport: string;
  scrollWidth: number;
  clientWidth: number;
  overflowX: boolean;
  instructionalTexts: string[];
  decisionButtonsVisible: string[];
  moreDetailsVisible: boolean;
  askAnythingHeading: boolean;
  keyboardBannerVisible: boolean;
  shortcutsHelpPresent: boolean;
};

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(500);
}

async function shot(page: Page, vp: (typeof VIEWPORTS)[number], label: string) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(OUT, `${label}__${vp.name}.png`),
    fullPage: true,
  });
  console.log("saved", label, vp.name);
}

async function measure(page: Page, label: string, viewport: string): Promise<Metrics> {
  // Keep this body free of nested function decls — tsx injects __name which breaks page.evaluate.
  return page.evaluate(({ label: l, viewport: v }) => {
    const instructionalTexts = Array.from(document.querySelectorAll("p, span, div, small, h1, h2, h3, li"))
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) =>
        /One candidate at a time|Keyboard:|← reject|Swipe or use buttons|Ask anything|suggestions are shortcuts|More details/i.test(
          t,
        ),
      )
      .slice(0, 30);

    // Permanent Reject/Save/Approve row only — ignore items inside a closed ⋯ menu.
    const decisionButtonsVisible: string[] = [];
    for (const b of Array.from(document.querySelectorAll("button"))) {
      const details = b.closest("details");
      if (details && !details.open) continue;
      const style = window.getComputedStyle(b);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      const rect = b.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const t = (b.textContent || "").replace(/\s+/g, " ").trim();
      if (/^(Reject|Save|Approve)$/i.test(t)) decisionButtonsVisible.push(t);
    }

    let moreDetailsVisible = false;
    for (const el of Array.from(document.querySelectorAll("button, a"))) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (/More details/i.test((el.textContent || "").replace(/\s+/g, " ").trim())) {
        moreDetailsVisible = true;
        break;
      }
    }

    let askAnythingHeading = false;
    for (const el of Array.from(document.querySelectorAll("h1, h2, h3, legend, label, p"))) {
      if (/^Ask anything/i.test((el.textContent || "").replace(/\s+/g, " ").trim())) {
        askAnythingHeading = true;
        break;
      }
    }

    let keyboardBannerVisible = false;
    for (const el of Array.from(document.querySelectorAll("p, div, banner, [role='note']"))) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!/Keyboard:/i.test(t) && !/^Keyboard\b/i.test(t)) continue;
      if (/reject|approve|swipe/i.test(t) || t.length > 20) {
        keyboardBannerVisible = true;
        break;
      }
    }

    return {
      label: l,
      viewport: v,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      instructionalTexts,
      decisionButtonsVisible,
      moreDetailsVisible,
      askAnythingHeading,
      keyboardBannerVisible,
      shortcutsHelpPresent: Boolean(document.querySelector('[aria-label="Keyboard shortcuts help"]')),
    };
  }, { label, viewport });
}

async function login(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForSelector("#owner-password", { timeout: 15_000 });
      await page.waitForTimeout(300);
      await page.locator("#owner-password").fill(PASSWORD!);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(/\/queue/, { timeout: 20_000, waitUntil: "domcontentloaded" });
      await settle(page);
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      console.log("LOGIN_RETRY", attempt + 1, String(err).slice(0, 120));
      await page.waitForTimeout(700);
    }
  }
  // Same-origin fetch required (page.request is treated as cross-origin).
  const reset = await page.evaluate(async () => {
    const res = await fetch("/api/dev/reset-mock", { method: "POST" });
    return { status: res.status, body: await res.text() };
  });
  console.log("MOCK_RESET", reset.status, reset.body.slice(0, 120));
  await page.goto(`${BASE}/queue`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);
}

async function firstQueueCandidateId(page: Page): Promise<string | null> {
  // Avoid nested function decls inside evaluate — tsx injects __name.
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

  // Prefer Enter / tap on focused card (keyboard + swipe contract)
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

function evaluateAcceptance(metrics: Metrics[], checks: CheckResult[]) {
  const queueMetrics = metrics.filter((m) => m.label === "queue" || m.label === "queue-at-rest");
  const detailMetrics = metrics.filter((m) => m.label === "candidate-detail" || m.label === "ask-composer");

  const anyMoreDetails = queueMetrics.some((m) => m.moreDetailsVisible);
  checks.push({
    id: "no-more-details-button",
    pass: !anyMoreDetails,
    detail: anyMoreDetails
      ? "More details button still visible on queue"
      : "No More details button on queue captures",
  });

  const anyKeyboardBanner = queueMetrics.some((m) => m.keyboardBannerVisible);
  checks.push({
    id: "no-permanent-keyboard-banner",
    pass: !anyKeyboardBanner,
    detail: anyKeyboardBanner
      ? `Keyboard banner text found: ${queueMetrics.flatMap((m) => m.instructionalTexts).join(" | ")}`
      : "No permanent Keyboard banner on queue",
  });

  const decisionOnQueue = queueMetrics.flatMap((m) => m.decisionButtonsVisible);
  checks.push({
    id: "no-visible-reject-save-approve-row",
    pass: decisionOnQueue.length === 0,
    detail:
      decisionOnQueue.length === 0
        ? "No visible Reject/Save/Approve buttons on queue card"
        : `Visible decision labels on queue: ${[...new Set(decisionOnQueue)].join(", ")}`,
  });

  const askHeading = detailMetrics.some((m) => m.askAnythingHeading) ||
    metrics.some((m) => m.askAnythingHeading);
  checks.push({
    id: "no-ask-anything-heading",
    pass: !askHeading,
    detail: askHeading ? "Ask anything heading still present" : "No Ask anything heading",
  });

  const shortcuts = queueMetrics.some((m) => m.shortcutsHelpPresent);
  checks.push({
    id: "keyboard-shortcuts-help-exists",
    pass: shortcuts,
    detail: shortcuts
      ? "Keyboard shortcuts help (?) control present"
      : "Missing aria-label Keyboard shortcuts help",
  });

  const overflow = metrics.filter((m) => m.overflowX);
  checks.push({
    id: "no-horizontal-overflow",
    pass: overflow.length === 0,
    detail:
      overflow.length === 0
        ? "No horizontal overflow across captures"
        : `Overflow on: ${overflow.map((m) => `${m.label}@${m.viewport}`).join(", ")}`,
  });
}

async function main() {
  if (!PASSWORD) throw new Error("Set APP_PASSWORD");
  mkdirSync(OUT, { recursive: true });

  const consoleLogs: Array<{ type: string; text: string }> = [];
  const failedRequests: Array<{ url: string; status: number }> = [];
  const metrics: Metrics[] = [];
  const checks: CheckResult[] = [];
  const interactionNotes: string[] = [];

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
    for (const vp of VIEWPORTS) {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await shot(page, vp, "login");
    }

    await login(page);

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
        const label = route === "queue" ? "queue-at-rest" : route;
        await shot(page, vp, label);
        if (route === "queue") {
          await page.screenshot({
            path: path.join(OUT, `queue__${vp.name}.png`),
            fullPage: true,
          });
        }
        metrics.push(await measure(page, label, vp.name));
      }
    }

    // Queue interaction: shortcuts help + keyboard Enter open
    await page.goto(`${BASE}/queue`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.setViewportSize({ width: 1440, height: 1000 });

    const help = page.getByLabel("Keyboard shortcuts help");
    if (await help.count()) {
      await help.click();
      await page.waitForTimeout(200);
      const panelText = await page.locator("details").first().innerText().catch(() => "");
      interactionNotes.push(`shortcuts-panel: ${panelText.replace(/\s+/g, " ").slice(0, 200)}`);
      checks.push({
        id: "keyboard-shortcuts-panel-content",
        pass: /Left arrow|Right arrow|S —|Enter/i.test(panelText),
        detail: /Left arrow|Right arrow/i.test(panelText)
          ? "Shortcuts panel lists arrow/S/Enter"
          : `Unexpected panel content: ${panelText.slice(0, 120)}`,
      });
      // close by clicking again / blur
      await page.keyboard.press("Escape").catch(() => undefined);
    } else {
      checks.push({
        id: "keyboard-shortcuts-panel-content",
        pass: false,
        detail: "Could not open shortcuts help",
      });
    }

    const opened = await openFirstCandidate(page);
    checks.push({
      id: "candidate-detail-reachable",
      pass: opened,
      detail: opened ? `Opened ${page.url()}` : "Could not open candidate detail from queue",
    });
    interactionNotes.push(opened ? `detail-open: ${page.url()}` : "detail-open: failed");

    if (opened) {
      // Ensure hydrated before first shot
      await page.getByLabel("Ask a question about this candidate").waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
      await settle(page);

      for (const vp of VIEWPORTS) {
        await shot(page, vp, "candidate-detail");
        metrics.push(await measure(page, "candidate-detail", vp.name));

        const ask = page.getByLabel("Ask a question about this candidate");
        if (await ask.count()) {
          await ask.scrollIntoViewIfNeeded().catch(() => undefined);
          await page.waitForTimeout(250);
          await shot(page, vp, "ask-composer");
          metrics.push(await measure(page, "ask-composer", vp.name));
        }
      }

      // Ask placeholder check
      const ask = page.getByLabel("Ask a question about this candidate");
      if (await ask.count()) {
        const ph = await ask.getAttribute("placeholder");
        checks.push({
          id: "ask-composer-placeholder",
          pass: Boolean(ph) && !/Ask anything/i.test(ph || ""),
          detail: `placeholder="${ph}"`,
        });
      } else {
        checks.push({
          id: "ask-composer-placeholder",
          pass: false,
          detail: "Ask composer textarea not found",
        });
      }
    }

    // Reduced motion
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${BASE}/queue`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await shot(page, VIEWPORTS[0], "queue-reduced-motion");

    evaluateAcceptance(metrics, checks);

    const report = {
      step: 15,
      capturedAt: new Date().toISOString(),
      checks,
      interactionNotes,
      metrics,
      consoleLogs,
      failedRequests: failedRequests.slice(0, 80),
    };
    writeFileSync(path.join(OUT, "console.json"), JSON.stringify(report, null, 2));

    const failed = checks.filter((c) => !c.pass);
    console.log("CHECKS", JSON.stringify(checks, null, 2));
    if (failed.length) {
      console.log("AFTER_CAPTURE_OK_WITH_FAILS", failed.map((f) => f.id).join(","));
    } else {
      console.log("AFTER_CAPTURE_OK");
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("AFTER_CAPTURE_FAIL", e);
  process.exit(1);
});
