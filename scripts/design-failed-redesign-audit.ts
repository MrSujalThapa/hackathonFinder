/**
 * Failed redesign audit capture — Step 1 before corrective edits.
 * Captures queue/detail/history/ask across phone, tablet, laptop, wide desktop.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "../src/cli/loadEnv";

loadLocalEnv();
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.APP_PASSWORD;
const OUT = path.resolve("artifacts/design/failed-redesign-audit");
const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x1000", width: 1440, height: 1000 },
  { name: "1728x900", width: 1728, height: 900 },
] as const;

type Metrics = {
  label: string;
  viewport: string;
  scrollWidth: number;
  clientWidth: number;
  overflowX: boolean;
  mainWidth: number | null;
  cardWidth: number | null;
  sidebarWidth: number | null;
  instructionalTexts: string[];
  decisionButtons: string[];
  moreDetailsVisible: boolean;
};

async function settle(page: Page) {
  await page.waitForLoadState("load").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(350);
}

async function shot(page: Page, vp: (typeof VIEWPORTS)[number], label: string) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(120);
  await page.screenshot({
    path: path.join(OUT, `${label}__${vp.name}.png`),
    fullPage: true,
  });
  console.log("saved", label, vp.name);
}

async function measure(page: Page, label: string, viewport: string): Promise<Metrics> {
  return page.evaluate(({ label: l, viewport: v }) => {
    const main = document.querySelector("main");
    const card = document.querySelector("[data-testid='candidate-card'], article");
    const sidebar = document.querySelector("aside, nav[aria-label], [data-shell-sidebar]");
    const instructional = Array.from(document.querySelectorAll("p, span, div, small, h1, h2"))
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(
        (t) =>
          /One candidate at a time|Keyboard:|← reject|Swipe or use buttons|Ask anything|suggestions are shortcuts|More details/i.test(
            t,
          ),
      )
      .slice(0, 20);
    const decisionButtons = Array.from(document.querySelectorAll("button"))
      .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => /^(Reject|Save|Approve|Unsave|Restore)/i.test(t));
    const moreDetailsVisible = Array.from(document.querySelectorAll("button")).some((b) =>
      /More details/i.test(b.textContent || ""),
    );
    return {
      label: l,
      viewport: v,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
      cardWidth: card ? Math.round(card.getBoundingClientRect().width) : null,
      sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
      instructionalTexts: instructional,
      decisionButtons,
      moreDetailsVisible,
    };
  }, { label, viewport });
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await settle(page);
  await page.getByLabel("Owner password").fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/queue/, { timeout: 20_000 });
  await settle(page);
}

async function openFirstCandidate(page: Page): Promise<boolean> {
  await page.goto(`${BASE}/queue`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);
  const link = page.locator('a[href*="/candidate/"]').first();
  if (await link.count()) {
    await link.click();
    await page.waitForURL(/\/candidate\//, { timeout: 15_000 }).catch(() => undefined);
    await settle(page);
    return page.url().includes("/candidate/");
  }
  const more = page.getByRole("button", { name: /More details/i });
  if (await more.count()) {
    await more.click();
    await settle(page);
  }
  const article = page.getByRole("article").first();
  if (await article.count()) {
    await article.focus().catch(() => undefined);
    await page.keyboard.press("Enter").catch(() => undefined);
    await page.waitForTimeout(800);
  }
  if (!page.url().includes("/candidate/")) {
    // Try navigating via API-backed list link in expanded card
    const href = await page.locator('a[href*="/candidate/"]').first().getAttribute("href").catch(() => null);
    if (href) {
      await page.goto(`${BASE}${href.startsWith("http") ? new URL(href).pathname : href}`, {
        waitUntil: "load",
      });
      await settle(page);
    }
  }
  return page.url().includes("/candidate/");
}

async function main() {
  if (!PASSWORD) throw new Error("Set APP_PASSWORD");
  mkdirSync(OUT, { recursive: true });
  const consoleLogs: Array<{ type: string; text: string }> = [];
  const failedRequests: Array<{ url: string; status: number }> = [];
  const metrics: Metrics[] = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleLogs.push({ type: msg.type(), text: msg.text() });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
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
            await shot(page, vp, route);
            metrics.push(await measure(page, route, vp.name));
            break;
          } catch (err) {
            if (attempt === 2) throw err;
            await page.waitForTimeout(800);
          }
        }
      }
    }

    const opened = await openFirstCandidate(page);
    if (opened) {
      for (const vp of VIEWPORTS) {
        await shot(page, vp, "candidate-detail");
        metrics.push(await measure(page, "candidate-detail", vp.name));
        // Ask section into view
        const ask = page.getByText(/Ask anything about this event/i);
        if (await ask.count()) {
          await ask.scrollIntoViewIfNeeded().catch(() => undefined);
          await page.waitForTimeout(200);
          await shot(page, vp, "ask-section");
        }
      }
    } else {
      console.log("WARN: could not open candidate detail");
    }

    // NEEDS_REVIEW / long description if present on queue
    await page.goto(`${BASE}/queue`, { waitUntil: "load" });
    await settle(page);
    for (const vp of VIEWPORTS) {
      await shot(page, vp, "queue-at-rest");
    }

    writeFileSync(
      path.join(OUT, "metrics.json"),
      JSON.stringify({ metrics, consoleLogs, failedRequests: failedRequests.slice(0, 80) }, null, 2),
    );
    console.log("FAILED_REDESIGN_AUDIT_OK");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("FAILED_REDESIGN_AUDIT_FAIL", e);
  process.exit(1);
});
