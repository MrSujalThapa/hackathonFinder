import { withPlaywright } from "@/lib/browser/playwright";
import { assertSafeCustomSourceUrl } from "@/server/customSources/urlSafety";
import { inspectApplicationForm } from "@/core/applications/formInspection";
import type { ApplicationQuestion } from "@/core/applications/types";

export type FormInspectionResult = { url: string; questions: ApplicationQuestion[]; blocker: "login" | "captcha" | "mfa" | "payment" | "legal" | null };

/** Browser inspection is read-only; this service never fills or submits a field. */
export async function inspectApplicationUrl(rawUrl: string): Promise<FormInspectionResult> {
  const url = (await assertSafeCustomSourceUrl(rawUrl)).toString();
  return withPlaywright(async ({ page }) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    // Many real application platforms (Typeform, Airtable, custom SPAs) render
    // form fields client-side after domcontentloaded fires. Wait for at least
    // one to attach before snapshotting the DOM, so a real form isn't misread
    // as empty. Bounded and best-effort: pages with no form fields (blockers,
    // static info pages) fall through unchanged once the wait times out.
    await page
      .locator("input, textarea, select")
      .first()
      .waitFor({ state: "attached", timeout: 8_000 })
      .catch(() => undefined);
    const html = await page.content();
    const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    const blocker = /captcha|recaptcha|hcaptcha/.test(text) ? "captcha" : /two.factor|verification code|one-time password/.test(text) ? "mfa" : /sign in|log in/.test(text) && !inspectApplicationForm(html).length ? "login" : /payment|credit card/.test(text) ? "payment" : /terms and conditions|legal agreement/.test(text) ? "legal" : null;
    return { url, questions: inspectApplicationForm(html), blocker };
  });
}
