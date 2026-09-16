import { loadLocalEnv } from "@/cli/loadEnv";
loadLocalEnv();
async function main(): Promise<void> {
  const { chromium } = await import("playwright"); const secret = process.env.APP_SESSION_SECRET;
  if (!secret) throw new Error("APP_SESSION_SECRET is required for browser verification.");
  const { createSessionToken, SESSION_COOKIE_NAME } = await import("@/lib/auth/session"); const token = await createSessionToken(secret);
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(7_000);
  try {
    await page.context().addCookies([{ name: SESSION_COOKIE_NAME, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    const apiFailures: string[] = []; page.on("response", (response) => { if (response.url().includes("/api/applications") && response.status() >= 400) apiFailures.push(`${response.url()}:${response.status()}`); });
    console.log("open drafts"); await page.goto("http://localhost:3100/drafts", { waitUntil: "domcontentloaded" });
    const applicationId = process.env.APPLICATION_FIXTURE_ID; if (!applicationId) throw new Error("APPLICATION_FIXTURE_ID is required.");
    await page.locator(`a[href="/drafts/${applicationId}"]`).click(); await page.waitForURL(`**/drafts/${applicationId}`); await page.waitForLoadState("domcontentloaded"); console.log("open detail");
    await page.getByText("GitHub profile"); await page.getByText("asset bank"); await page.getByText("1 blocker"); console.log(`fields=${await page.locator("textarea").count()}`);
    const answer = page.locator("textarea").last(); await answer.fill("I want to collaborate with other builders."); await answer.blur(); console.log("edit");
    await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText("Saved. External form inspection has not resumed."); console.log("save");
    await page.getByRole("button", { name: "Save & Continue" }).click(); await page.getByText("Saved and continued safely. No external submission was attempted."); console.log("continue");
    await page.getByRole("button", { name: "Pause" }).click(); await page.getByText("Draft paused."); console.log("pause");
    await page.getByRole("button", { name: "Do this myself" }).click(); await page.getByText("Automation stopped. This draft is now user managed."); console.log("manage");
    page.once("dialog", (dialog) => void dialog.accept()); await page.getByRole("button", { name: "Delete draft" }).click(); await page.getByText("Draft deleted; no automation will continue."); console.log("delete");
    if (apiFailures.length) throw new Error(`Application API failures: ${apiFailures.join(", ")}`);
    await page.screenshot({ path: "artifacts/pass1-drafts-mobile.png", fullPage: true }); console.log(JSON.stringify({ drafts: true, mobileViewport: true, controls: ["edit", "save", "save_continue", "pause", "do_myself", "delete"] }));
  } finally { await browser.close(); }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
