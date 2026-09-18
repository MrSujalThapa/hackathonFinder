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
    const html = await page.content();
    const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    const blocker = /captcha|recaptcha|hcaptcha/.test(text) ? "captcha" : /two.factor|verification code|one-time password/.test(text) ? "mfa" : /sign in|log in/.test(text) && !inspectApplicationForm(html).length ? "login" : /payment|credit card/.test(text) ? "payment" : /terms and conditions|legal agreement/.test(text) ? "legal" : null;
    return { url, questions: inspectApplicationForm(html), blocker };
  });
}
