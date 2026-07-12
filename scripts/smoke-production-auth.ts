/**
 * Protected browser smoke for a running local/preview deployment.
 *
 * Requires:
 * - app server already running
 * - owner auth configured
 * - SMOKE_OWNER_PASSWORD set
 * - preferably USE_MOCK_CANDIDATES=true for non-destructive local smoke
 */
import { chromium } from "playwright";

async function main(): Promise<void> {
  const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
  const password = process.env.SMOKE_OWNER_PASSWORD;
  if (!password) {
    throw new Error("Set SMOKE_OWNER_PASSWORD for smoke:prod.");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Owner password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/queue", { timeout: 10_000 });

    const card = page.getByRole("article").first();
    await card.waitFor({ timeout: 15_000 });
    const name = (await card.locator("h2").first().textContent())?.trim();
    if (!name) throw new Error("Queue card missing candidate name");

    await page.getByRole("button", { name: "Approve" }).click();
    await page.goto(`${baseUrl}/approved`, { waitUntil: "networkidle" });
    await page.getByText(name, { exact: false }).first().waitFor({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /logout/i }).click();
    await page.waitForURL("**/login", { timeout: 10_000 });
    await page.goto(`${baseUrl}/queue`, { waitUntil: "networkidle" });
    await page.waitForURL("**/login?next=%2Fqueue", { timeout: 10_000 });
    console.log("SMOKE OK");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("SMOKE FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
});
