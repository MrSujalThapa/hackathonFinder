import { chromium, type Browser, type Page } from "playwright";

export type PlaywrightSession = {
  browser: Browser;
  page: Page;
};

export type WithPlaywrightOptions = {
  timeoutMs?: number;
  headless?: boolean;
};

export function isPlaywrightBrowserMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("executable doesn't exist") ||
    message.includes("browser is not installed") ||
    message.includes("npx playwright install")
  );
}

export function formatPlaywrightInstallHint(): string {
  return "Playwright Chromium is not installed. Run: npx playwright install chromium";
}

export async function withPlaywright<T>(
  fn: (session: PlaywrightSession) => Promise<T>,
  options: WithPlaywrightOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const browser = await chromium.launch({ headless: options.headless ?? true });

  try {
    const context = await browser.newContext({
      userAgent: "HackathonApprovalAgent/1.0",
    });
    context.setDefaultTimeout(timeoutMs);
    context.setDefaultNavigationTimeout(timeoutMs);

    const page = await context.newPage();

    try {
      return await fn({ browser, page });
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function gotoAndWaitForContent(
  page: Page,
  url: string,
  selector: string,
  timeoutMs = 15_000,
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
}
