import { chromium } from "playwright";
import { loadLocalEnv } from "../src/cli/loadEnv";

loadLocalEnv();

const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
const password = process.env.APP_PASSWORD;
const routes = [
  ["Queue", "/queue", "Queue"],
  ["Drafts", "/drafts", "Drafts"],
  ["Draft detail", null, "Continue application"],
  ["Terminal", "/terminal", "Discovery terminal"],
  ["Submitted", "/submitted", "Submitted"],
  ["Profile", "/profile", "Profile"],
  ["Questions", "/questions", "Question Bank"],
  ["Assets", "/assets", "Asset Bank"],
  ["Notifications", "/notifications", "Notifications"],
  ["Settings", "/settings", "Settings"],
] as const;
const requested = process.env.PRIVATE_ROUTE_NAMES?.split(",").filter(Boolean);
const selected = requested ? routes.filter(([name]) => requested.includes(name)) : routes;

async function main(): Promise<void> {
  if (!base.startsWith("https://") || !password) throw new Error("APP_BASE_URL and APP_PASSWORD are required");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/login`, { waitUntil: "networkidle", timeout: 45_000 });
    // Wait for React hydration: clicking before handlers attach causes a
    // native submit that reloads /login and wipes the password field.
    await page.waitForFunction(() => {
      const form = document.querySelector("form") as unknown as Record<string, unknown> | null;
      return Boolean(form) && Object.keys(form as object).some((key) => key.startsWith("__react"));
    }, undefined, { timeout: 30_000 });
    // Playwright fill() can bypass React 19 controlled-input tracking; set the
    // value through the native setter so the form state updates reliably.
    await page.evaluate((pw) => {
      const input = document.querySelector("#owner-password") as HTMLInputElement | null;
      if (!input) throw new Error("Owner password input not found");
      const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      nativeSetter?.call(input, pw);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, password);
    const [loginResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/auth/login"), { timeout: 20_000 }),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);
    if (loginResponse.status() !== 200) throw new Error(`Login API returned ${loginResponse.status()}`);
    await page.waitForURL((url) => url.origin === base && url.pathname === "/queue", { timeout: 30_000 });
    console.log("LOGIN OK");
    // Resolve one real draft id for the draft-detail check.
    let draftPath: string | null = null;
    try {
      const draftsResponse = await page.request.get(`${base}/api/applications`);
      const draftsBody = (await draftsResponse.json()) as { data?: { applications?: Array<{ id: string }> } };
      const firstId = draftsBody.data?.applications?.[0]?.id;
      if (firstId) draftPath = `/drafts/${firstId}`;
    } catch {
      draftPath = null;
    }
    for (const [name, path, heading] of selected) {
      const target = path ?? draftPath;
      if (!target) {
        console.log(`ROUTE SKIP ${name} (no draft available)`);
        continue;
      }
      const response = await page.goto(`${base}${target}`, { waitUntil: "networkidle", timeout: 40_000 });
      await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 40_000 });
      const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      if (layout.scrollWidth > layout.clientWidth) throw new Error(`${name} has horizontal overflow`);
      if (new URL(page.url()).origin !== base) throw new Error(`${name} left private origin`);
      console.log(`ROUTE OK ${name} ${response?.status() ?? "n/a"}`);
    }
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
