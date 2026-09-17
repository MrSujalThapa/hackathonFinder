import { chromium } from "playwright";
import { loadLocalEnv } from "../src/cli/loadEnv";

loadLocalEnv();

const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
const password = process.env.APP_PASSWORD;
const routes = [
  ["Queue", "/queue", "Queue"],
  ["Drafts", "/drafts", "Drafts"],
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
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByLabel("Owner password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => url.origin === base && url.pathname === "/queue", { timeout: 30_000 });
    console.log("LOGIN OK");
    for (const [name, path, heading] of selected) {
      const response = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 40_000 });
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
