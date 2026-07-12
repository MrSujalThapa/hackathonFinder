/**
 * Capture remaining error/empty states only (loading already saved).
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SMOKE_OWNER_PASSWORD!;
const OUT = path.resolve("artifacts/design/before");
const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x1000", width: 1440, height: 1000 },
] as const;

async function settle(page: Page) {
  await page.waitForLoadState("load").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await settle(page);
    await page.getByLabel("Owner password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/queue/, { timeout: 20_000 });
    await settle(page);

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
      await page.setViewportSize(vp);
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(OUT, `error__${vp.name}.png`),
        fullPage: true,
      });
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
      await page.setViewportSize(vp);
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(OUT, `empty-queue__${vp.name}.png`),
        fullPage: true,
      });
    }
    writeFileSync(path.join(OUT, "console-and-network.json"), "{}\n");
    console.log("REMAINING_CAPTURE_OK");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
