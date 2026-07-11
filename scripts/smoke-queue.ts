/**
 * Lightweight browser smoke test for the approval queue.
 * Requires the Next.js server with USE_MOCK_CANDIDATES=true.
 *
 *   npm run dev
 *   npm run smoke:queue
 */
import { chromium } from "playwright";

async function main(): Promise<void> {
  const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`${baseUrl}/queue`, { waitUntil: "networkidle" });

    const card = page.getByRole("article").first();
    await card.waitFor({ timeout: 15_000 });
    const name = (await card.locator("h2").first().textContent())?.trim();
    if (!name) {
      throw new Error("Queue card missing candidate name");
    }
    console.log(`queue card: ${name}`);

    await page.getByRole("button", { name: "Approve" }).click();
    await page.waitForTimeout(800);

    // Confirm via API that status flipped before checking history UI.
    const approvedApi = await page.request.get(
      `${baseUrl}/api/candidates?status=APPROVED&limit=50`,
    );
    const approvedJson = await approvedApi.json();
    const found = (approvedJson.data?.candidates ?? []).some(
      (item: { name: string }) => item.name === name,
    );
    if (!found) {
      throw new Error(`Approved API list missing ${name}`);
    }

    await page.goto(`${baseUrl}/approved`, { waitUntil: "networkidle" });
    await page.getByText(name, { exact: false }).first().waitFor({
      timeout: 10_000,
    });
    console.log(`approved list contains: ${name}`);
    console.log("SMOKE OK");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("SMOKE FAIL", error);
  process.exit(1);
});
