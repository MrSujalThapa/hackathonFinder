import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve("artifacts/design/failed-redesign-audit");
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/login", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.getByLabel("Owner password").fill("design-overhaul-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/queue/, { timeout: 20_000 });
  await page.waitForTimeout(600);

  const sizes = [
    { name: "390x844", width: 390, height: 844 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "1440x1000", width: 1440, height: 1000 },
    { name: "1728x900", width: 1728, height: 900 },
  ] as const;

  const metrics: unknown[] = [];
  for (const vp of sizes) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(350);
    const m = await page.evaluate((name) => {
      const card = document.querySelector("article");
      const main = document.querySelector("main");
      return {
        viewport: name,
        clientWidth: document.documentElement.clientWidth,
        cardWidth: card ? Math.round(card.getBoundingClientRect().width) : null,
        mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
        unusedPx:
          main && card
            ? Math.round(
                main.getBoundingClientRect().width - card.getBoundingClientRect().width,
              )
            : null,
        overflowX:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
      };
    }, vp.name);
    metrics.push(m);
    console.log(JSON.stringify(m));
  }

  await page.goto("http://localhost:3000/candidate/aaaaaaaa-aaaa-4aaa-8aaa-000000000002", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: path.join(OUT, "candidate-detail__1440x1000.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(OUT, "candidate-detail__390x844.png"),
    fullPage: true,
  });

  const askCount = await page.getByText(/Ask anything/i).count();
  console.log("askVisible", askCount);
  if (askCount) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByText(/Ask anything/i).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(OUT, "ask-section__1440x1000.png"),
      fullPage: false,
    });
  }

  const actions = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .map((b) => (b.textContent || "").trim())
      .filter((t) => /Approve|Reject|Save|Restore|Unsave|Ask/i.test(t)),
  );
  console.log("detailActions", actions);

  writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify({ metrics, actions }, null, 2));
  await browser.close();
  console.log("MEASURE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
