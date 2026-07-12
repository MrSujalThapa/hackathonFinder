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
    const loginNavigation = page
      .waitForURL("**/queue", { timeout: 10_000 })
      .catch(() => null);
    await page.getByRole("button", { name: "Sign in" }).click();
    await loginNavigation;
    if (new URL(page.url()).pathname !== "/queue") {
      await page.goto(`${baseUrl}/queue`, { waitUntil: "networkidle" });
    }

    const card = page.getByRole("article").first();
    await card.waitFor({ timeout: 15_000 });
    const name = (await card.locator("h2").first().textContent())?.trim();
    if (!name) throw new Error("Queue card missing candidate name");

    // Queue is swipe/keyboard-first — no visible Approve button row.
    await card.focus().catch(() => undefined);
    await page.keyboard.press("ArrowRight");
    let found = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const approvedApi = await page.request.get(
        `${baseUrl}/api/candidates?status=APPROVED&limit=50`,
      );
      const approvedJson = await approvedApi.json();
      found = (approvedJson.data?.candidates ?? []).some(
        (item: { name: string }) => item.name === name,
      );
      if (found) break;
      await page.waitForTimeout(500);
    }
    if (!found) {
      throw new Error(`Approved API list missing ${name}`);
    }

    await page.goto(`${baseUrl}/approved`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Approved" }).waitFor();

    await page.getByRole("button", { name: /logout/i }).click();
      await page.waitForURL("**/login", { timeout: 10_000 }).catch(() => null);
      if (new URL(page.url()).pathname !== "/login") {
        await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
      }
      await page.goto(`${baseUrl}/queue`, { waitUntil: "networkidle" });
      await page.waitForURL("**/login**", { timeout: 10_000 }).catch(() => null);
      const redirectedUrl = new URL(page.url());
      if (
        redirectedUrl.pathname !== "/login" ||
        redirectedUrl.searchParams.get("next") !== "/queue"
      ) {
        throw new Error(`Expected logout redirect to login, got ${page.url()}`);
      }
      console.log("SMOKE OK");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("SMOKE FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
});
