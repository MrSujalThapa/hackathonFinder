/**
 * After-implementation visual capture for design overhaul.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SMOKE_OWNER_PASSWORD ?? process.env.DESIGN_OWNER_PASSWORD;
const OUT = path.resolve("artifacts/design/after");
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

async function shot(page: Page, vp: (typeof VIEWPORTS)[number], label: string) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(OUT, `${label}__${vp.name}.png`),
    fullPage: true,
  });
  console.log("saved", label, vp.name);
}

async function main() {
  if (!PASSWORD) throw new Error("Set SMOKE_OWNER_PASSWORD");
  mkdirSync(OUT, { recursive: true });
  const consoleLogs: Array<{ type: string; text: string }> = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  try {
    for (const vp of VIEWPORTS) {
      await page.goto(`${BASE}/login`, { waitUntil: "load" });
      await settle(page);
      await shot(page, vp, "login");
    }

    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await settle(page);
    await page.getByLabel("Owner password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/queue/, { timeout: 20_000 });
    await settle(page);

    for (const route of ["queue", "approved", "rejected", "saved", "settings"] as const) {
      for (const vp of VIEWPORTS) {
        await page.goto(`${BASE}/${route}`, { waitUntil: "load" });
        await settle(page);
        await shot(page, vp, route);
      }
    }

    // Open first queue candidate via Enter if possible
    await page.goto(`${BASE}/queue`, { waitUntil: "load" });
    await settle(page);
    const article = page.getByRole("article").first();
    if (await article.count()) {
      await article.focus().catch(() => undefined);
      await page.keyboard.press("Enter").catch(() => undefined);
      await page.waitForTimeout(800);
      if (!page.url().includes("/candidate/")) {
        // Fallback: click More details then rely on queue still
        await page.getByRole("button", { name: /More details/i }).click().catch(() => undefined);
      }
      await settle(page);
      if (page.url().includes("/candidate/")) {
        for (const vp of VIEWPORTS) await shot(page, vp, "candidate-detail");
      }
    }

    // Reduced motion
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${BASE}/queue`, { waitUntil: "load" });
    await settle(page);
    await shot(page, VIEWPORTS[0], "queue-reduced-motion");

    writeFileSync(path.join(OUT, "console.json"), JSON.stringify({ consoleLogs }, null, 2));
    console.log("AFTER_CAPTURE_OK");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("AFTER_CAPTURE_FAIL", e);
  process.exit(1);
});
