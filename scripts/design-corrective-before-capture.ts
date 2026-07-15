/**
 * Corrective-before visual audit capture (STEP 1).
 * Does not modify production components.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "../src/cli/loadEnv";

loadLocalEnv();
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.APP_PASSWORD;
const OUT = path.resolve("artifacts/design/corrective-before");

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
  return page.evaluate(({ label: l, viewport: v }) => {
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
        if (!askAnswerPreview && /recommend|Should I|trade-?off|next step|citation/i.test(t)) {
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
  }, { label, viewport });
}

async function login(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await settle(page);
      // Prefer same-origin API login — form hydration can lag behind Fast Refresh.
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

async function tryAskDecision(page: Page): Promise<{ ok: boolean; preview: string }> {
  const ask = page.getByLabel("Ask a question about this candidate");
  if (!(await ask.count())) return { ok: false, preview: "ask-missing" };

  await ask.scrollIntoViewIfNeeded().catch(() => undefined);
  await ask.fill("Should I do this hackathon?");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);

  const body = await page.locator("body").innerText().catch(() => "");
  const preview = body.replace(/\s+/g, " ").slice(0, 600);
  return { ok: true, preview };
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const consoleLogs: Array<{ type: string; text: string }> = [];
  const failedRequests: Array<{ url: string; status: number }> = [];
  const screenshots: string[] = [];
  const metrics: LayoutMetrics[] = [];
  const notes: string[] = [];

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

    const opened = await openFirstCandidate(page);
    notes.push(opened ? `detail-open: ${page.url()}` : "detail-open: failed");

    if (opened) {
      for (const vp of VIEWPORTS) {
        screenshots.push(await shot(page, vp, "candidate-detail"));
        metrics.push(await measure(page, "candidate-detail", vp.name));

        const ask = page.getByLabel("Ask a question about this candidate");
        if (await ask.count()) {
          await ask.scrollIntoViewIfNeeded().catch(() => undefined);
          await page.waitForTimeout(200);
          screenshots.push(await shot(page, vp, "ask-section"));
          metrics.push(await measure(page, "ask-section", vp.name));
        }
      }

      // Trigger one decision Ask at 1440 for visible answer QA
      await page.setViewportSize({ width: 1440, height: 1000 });
      await settle(page);
      const askResult = await tryAskDecision(page);
      notes.push(`ask-decision: ${askResult.ok ? "submitted" : "failed"}`);
      notes.push(`ask-preview: ${askResult.preview.slice(0, 400)}`);
      screenshots.push(await shot(page, VIEWPORTS[4], "ask-response"));
      metrics.push(await measure(page, "ask-response", "1440x1000"));
    }

    const report = {
      step: "corrective-before",
      capturedAt: new Date().toISOString(),
      baseUrl: BASE,
      viewports: VIEWPORTS,
      screenshots: screenshots.map((s) => path.relative(process.cwd(), s).replace(/\\/g, "/")),
      metrics,
      notes,
      consoleLogs: consoleLogs.slice(0, 40),
      failedRequests: failedRequests.slice(0, 80),
    };
    writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(report, null, 2));
    console.log("METRICS_OK", metrics.length, "screenshots", screenshots.length);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("CORRECTIVE_BEFORE_CAPTURE_FAIL", e);
  process.exit(1);
});
