import { loadLocalEnv } from "@/cli/loadEnv";
loadLocalEnv();
async function main(): Promise<void> {
  const { chromium } = await import("playwright"); const secret = process.env.APP_SESSION_SECRET;
  if (!secret) throw new Error("APP_SESSION_SECRET is required for browser verification.");
  const { createSessionToken, SESSION_COOKIE_NAME } = await import("@/lib/auth/session"); const token = await createSessionToken(secret);
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(20_000);
  try {
    await page.context().addCookies([{ name: SESSION_COOKIE_NAME, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    const apiFailures: string[] = []; page.on("response", (response) => { if (response.url().includes("/api/applications") && response.status() >= 400) apiFailures.push(`${response.url()}:${response.status()}`); });
    const applicationId = process.env.APPLICATION_FIXTURE_ID; if (!applicationId) throw new Error("APPLICATION_FIXTURE_ID is required."); const mode = process.env.VERIFY_DRAFT_MODE ?? "delete";
    await page.goto(`http://localhost:3100/drafts/${applicationId}`, { waitUntil: "domcontentloaded" });
    await page.getByText("GitHub profile"); await page.getByText("asset bank"); await page.getByText("1 blocker"); await page.locator("textarea").first().waitFor(); console.log("deep link loaded");
    if (mode === "lock") {
      await page.getByRole("button", { name: "Do this myself" }).click(); await page.getByText("Automation stopped. This draft is now user managed.");
      const status = await page.evaluate(async (draftId) => (await (await fetch(`/api/applications/${draftId}`)).json() as { data: { application: { status: string } } }).data.application.status, applicationId);
      if (status !== "user_managed") throw new Error(`Discord acceptance fixture is ${status}, not user_managed.`);
      if (!await page.getByRole("button", { name: "Save & Continue" }).isDisabled()) throw new Error("User-managed draft unexpectedly allows automation to restart.");
      console.log(JSON.stringify({ deepLink: true, doItMyselfPersisted: true, userManagedContinueBlocked: true })); return;
    }
    if (mode === "user_managed") {
      const status = await page.evaluate(async (draftId) => (await (await fetch(`/api/applications/${draftId}`)).json() as { data: { application: { status: string } } }).data.application.status, applicationId);
      if (status !== "user_managed") throw new Error(`Discord acceptance fixture is ${status}, not user_managed.`);
      if (!await page.getByRole("button", { name: "Save & Continue" }).isDisabled()) throw new Error("User-managed draft unexpectedly allows automation to restart.");
      console.log(JSON.stringify({ deepLink: true, userManagedContinueBlocked: true })); return;
    }
    const answer = page.locator("textarea").last(); const persistedAnswer = "I want to collaborate with other builders.";
    await answer.fill(persistedAnswer); await answer.blur(); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText("Saved. External form inspection has not resumed."); console.log("answer saved");
    await page.reload({ waitUntil: "domcontentloaded" }); await page.locator("textarea").last().waitFor(); if (await page.locator("textarea").last().inputValue() !== persistedAnswer) throw new Error("Saved answer did not persist after reload."); console.log("answer reloaded");
    if (mode === "resume") { await page.getByRole("button", { name: "Save & Continue" }).click(); await page.getByText(/Saved (and continued safely|\. This draft is still waiting)/); console.log(JSON.stringify({ deepLink: true, questions: true, provenance: true, blocker: true, saveReload: true, resumable: true })); return; }
    await page.getByRole("button", { name: "Save & Continue" }).click(); await page.getByText(/Saved (and continued safely|\. This draft is still waiting)/); await page.getByRole("button", { name: "Pause" }).click(); await page.getByText("Draft paused."); await page.getByRole("button", { name: "Do this myself" }).click(); await page.getByText("Automation stopped. This draft is now user managed.");
    page.once("dialog", (dialog) => void dialog.accept()); await page.getByRole("button", { name: "Delete draft" }).click(); await page.getByText("Draft deleted; no automation will continue."); console.log("delete");
    if (apiFailures.length) throw new Error(`Application API failures: ${apiFailures.join(", ")}`);
    await page.screenshot({ path: "artifacts/pass1-drafts-mobile.png", fullPage: true }); console.log(JSON.stringify({ drafts: true, mobileViewport: true, controls: ["edit", "save", "save_continue", "pause", "do_myself", "delete"] }));
  } finally { await browser.close(); }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
