import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { redactProfilePaths } from "@/lib/browser/profilePaths";

export type PersistentPlaywrightSession = {
  context: BrowserContext;
  page: Page;
};

export type WithPersistentPlaywrightOptions = {
  timeoutMs?: number;
  headless?: boolean;
  userAgent?: string;
};

export async function withPersistentPlaywright<T>(
  profileDir: string,
  fn: (session: PersistentPlaywrightSession) => Promise<T>,
  options: WithPersistentPlaywrightOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  mkdirSync(profileDir, { recursive: true });

  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: options.headless ?? true,
      userAgent: options.userAgent ?? "HackathonApprovalAgent/1.0",
      viewport: { width: 1280, height: 900 },
      args: ["--disable-blink-features=AutomationControlled"],
    });
    context.setDefaultTimeout(timeoutMs);
    context.setDefaultNavigationTimeout(timeoutMs);

    const page = context.pages()[0] ?? (await context.newPage());

    try {
      return await fn({ context, page });
    } finally {
      // Keep profile on disk; only close the context.
      await context.close().catch(() => undefined);
      context = undefined;
    }
  } catch (error) {
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (error instanceof Error) {
      error.message = redactProfilePaths(error.message, profileDir);
    }
    throw error;
  }
}
