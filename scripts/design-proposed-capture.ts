import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const html = path.resolve("docs/design/mockups/editorial-operations.html");
const out = path.resolve("artifacts/design/proposed");
mkdirSync(out, { recursive: true });

const shots = [
  { sel: '[data-shot="login-390"]', name: "login__390x844", w: 390, h: 844 },
  { sel: '[data-shot="queue-390"]', name: "queue__390x844", w: 390, h: 844 },
  { sel: '[data-shot="queue-1440"]', name: "queue__1440x1000", w: 1440, h: 1000 },
  { sel: '[data-shot="detail-1440"]', name: "candidate-detail__1440x1000", w: 1440, h: 1000 },
  { sel: '[data-shot="needs-review-390"]', name: "needs-review__390x844", w: 390, h: 844 },
  { sel: '[data-shot="states-768"]', name: "states__768x1024", w: 768, h: 1024 },
  { sel: '[data-shot="approved-1440"]', name: "approved__1440x1000", w: 1440, h: 1000 },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
for (const shot of shots) {
  await page.setViewportSize({ width: shot.w, height: shot.h });
  const el = page.locator(shot.sel);
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: path.join(out, `${shot.name}.png`) });
  console.log("saved", shot.name);
}
await browser.close();
console.log("PROPOSED_CAPTURE_OK");
