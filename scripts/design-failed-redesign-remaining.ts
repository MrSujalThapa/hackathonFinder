/**
 * Completes remaining failed-redesign audit captures (detail/ask/metrics).
 */
import { chromium } from "playwright";
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

async function settle(page: import("playwright").Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function shot(
  page: import("playwright").Page,
  vp: (typeof VIEWPORTS)[number],
  label: string,
) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(100);
  await page.screenshot({
    path: path.join(OUT, `${label}__${vp.name}.png`),
    fullPage: true,
  });
  console.log("saved", label, vp.name);
}

async function main() {
  if (!PASSWORD) throw new Error("Set APP_PASSWORD");
  const password = PASSWORD;
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const metrics: unknown[] = [];
  const consoleLogs: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleLogs.push(m.text());
  });

  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.getByLabel("Owner password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/queue/, { timeout: 20_000 });
    await settle(page);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await page.goto(`${BASE}/queue`, { waitUntil: "domcontentloaded" });
      await settle(page);
      metrics.push(
        await page.evaluate((name) => {
          const card = document.querySelector("article");
          const main = document.querySelector("main");
          const sidebar = document.querySelector("aside") || document.querySelector("nav");
          return {
            viewport: name,
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            overflowX:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth + 1,
            mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
            cardWidth: card ? Math.round(card.getBoundingClientRect().width) : null,
            sidebarWidth: sidebar
              ? Math.round(sidebar.getBoundingClientRect().width)
              : null,
            unusedCanvasApprox:
              main && card
                ? Math.round(
                    main.getBoundingClientRect().width - card.getBoundingClientRect().width,
                  )
                : null,
            hasOneCandidateCopy: /One candidate at a time/.test(document.body.innerText),
            hasKeyboardBanner: /Keyboard:\s*Left/.test(document.body.innerText),
            hasShortcutFooter: /← reject/.test(document.body.innerText),
            hasMoreDetails: Array.from(document.querySelectorAll("button")).some((b) =>
              /More details/i.test(b.textContent || ""),
            ),
            decisionButtons: Array.from(document.querySelectorAll("button"))
              .map((b) => (b.textContent || "").trim())
              .filter((t) => /^(Reject|Save|Approve)$/i.test(t)),
          };
        }, vp.name),
      );
      await shot(page, vp, "queue-at-rest");
    }

    // Prefer a known mock UUID; fall back to first queue card navigation
    await page.goto(`${BASE}/candidate/aaaaaaaa-aaaa-4aaa-8aaa-000000000001`, {
      waitUntil: "domcontentloaded",
    });
    await settle(page);
    if ((await page.getByText(/not found/i).count()) > 0) {
      await page.goto(`${BASE}/queue`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByRole("button", { name: /More details/i }).click().catch(() => undefined);
      await settle(page);
    }

    for (const vp of VIEWPORTS) {
      await shot(page, vp, "candidate-detail");
      const ask = page.getByText(/Ask anything about this event/i);
      if (await ask.count()) {
        await ask.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await shot(page, vp, "ask-section");
      }
    }

    // Approved candidate detail actions (state-unaware check)
    await page.goto(`${BASE}/approved`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const approvedLink = page.locator('a[href*="/candidate/"]').first();
    if (await approvedLink.count()) {
      await approvedLink.click();
      await settle(page);
      await shot(page, VIEWPORTS[2], "approved-candidate-detail");
      metrics.push({
        label: "approved-detail-actions",
        buttons: await page.evaluate(() =>
          Array.from(document.querySelectorAll("button"))
            .map((b) => (b.textContent || "").trim())
            .filter((t) => /Approve|Reject|Save|Restore|Unsave/i.test(t)),
        ),
      });
    }

    writeFileSync(
      path.join(OUT, "metrics.json"),
      JSON.stringify({ metrics, consoleLogs }, null, 2),
    );
    console.log(JSON.stringify(metrics, null, 2));
    console.log("REMAINING_AUDIT_OK");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("REMAINING_AUDIT_FAIL", e);
  process.exit(1);
});
