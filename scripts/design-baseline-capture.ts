/**
 * Baseline UI capture for design overhaul.
 * Follows webapp-testing workflow: networkidle, DOM recon, console capture, clean close.
 * Uses project Node Playwright (Python playwright module unavailable on this machine).
 */
import { chromium, type Page, type ConsoleMessage } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SMOKE_OWNER_PASSWORD ?? process.env.DESIGN_OWNER_PASSWORD;
const OUT = path.resolve("artifacts/design/before");

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x1000", width: 1440, height: 1000 },
] as const;

type LogEntry = { type: string; text: string; url?: string };

async function settle(page: Page): Promise<void> {
  // Next.js keeps long-lived connections; prefer load + short settle over networkidle alone.
  await page.waitForLoadState("load").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function shot(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  label: string,
): Promise<void> {
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.waitForTimeout(200);
  const file = path.join(OUT, `${label}__${viewport.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`saved ${file}`);
}

async function login(page: Page): Promise<void> {
  if (!PASSWORD) {
    throw new Error("Set SMOKE_OWNER_PASSWORD or DESIGN_OWNER_PASSWORD");
  }
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await settle(page);
  await page.getByLabel("Owner password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/queue/, { timeout: 20_000 }).catch(() => undefined);
  await settle(page);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const consoleLogs: LogEntry[] = [];
  const failedRequests: string[] = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on("requestfailed", (req) => {
    failedRequests.push(`${req.failure()?.errorText ?? "fail"} ${req.url()}`);
  });

  try {
    // Login
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/login`, { waitUntil: "load" });
      await settle(page);
      await shot(page, vp, "login");
    }

    await login(page);

    const routes: Array<{ label: string; path: string }> = [
      { label: "queue", path: "/queue" },
      { label: "approved", path: "/approved" },
      { label: "rejected", path: "/rejected" },
      { label: "saved", path: "/saved" },
      { label: "settings", path: "/settings" },
    ];

    for (const route of routes) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`${BASE}${route.path}`, { waitUntil: "load" });
        await settle(page);
        await shot(page, vp, route.label);
      }
    }

    // Candidate detail from first queue card link or article
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/queue`, { waitUntil: "load" });
    await settle(page);
    const article = page.getByRole("article").first();
    const hasCard = await article.count();
    if (hasCard) {
      await page.goto(
        `${BASE}/candidate/aaaaaaaa-aaaa-4aaa-8aaa-000000000001`,
        { waitUntil: "load" },
      );
      await settle(page);
      for (const vp of VIEWPORTS) {
        await shot(page, vp, "candidate-detail");
      }

      await page.goto(
        `${BASE}/candidate/aaaaaaaa-aaaa-4aaa-8aaa-000000000005`,
        { waitUntil: "load" },
      );
      await settle(page);
      for (const vp of VIEWPORTS) {
        await shot(page, vp, "needs-review");
      }
    }

    // Loading state: intercept and delay
    await page.route("**/api/candidates**", async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fallback();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const loadingNav = page.goto(`${BASE}/queue`, { waitUntil: "commit" });
    await page.waitForTimeout(700);
    await shot(page, VIEWPORTS[0], "loading");
    await loadingNav.catch(() => undefined);
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // Error state: force API failure
    await page.route("**/api/candidates**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced design-audit error" }),
      });
    });
    await page.goto(`${BASE}/queue`, { waitUntil: "load" });
    await settle(page);
    for (const vp of VIEWPORTS) {
      await shot(page, vp, "error");
    }
    await page.unrouteAll({ behavior: "ignoreErrors" });

    await page.route("**/api/candidates**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { candidates: [], nextCursor: null } }),
      });
    });
    await page.goto(`${BASE}/queue`, { waitUntil: "load" });
    await settle(page);
    for (const vp of VIEWPORTS) {
      await shot(page, vp, "empty-queue");
    }
    await page.unrouteAll({ behavior: "ignoreErrors" });

    writeFileSync(
      path.join(OUT, "console-and-network.json"),
      JSON.stringify({ consoleLogs, failedRequests }, null, 2),
    );
    console.log("BASELINE_CAPTURE_OK");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("BASELINE_CAPTURE_FAIL", error);
  process.exit(1);
});
