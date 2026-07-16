/**
 * Release Terminal validation through the real /terminal page (Playwright).
 * Writes ignored artifacts under .local-audits/release-terminal/.
 * Never prints secret values. Requires APP_PASSWORD and a running server.
 *
 * Usage:
 *   SMOKE_BASE_URL=http://localhost:3010 npx tsx scripts/release-terminal-validation.ts
 *   SMOKE_BASE_URL=http://localhost:3010 npx tsx scripts/release-terminal-validation.ts --only=A,B
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { loadLocalEnv } from "../src/cli/loadEnv";

loadLocalEnv();

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3010").replace(/\/$/, "");
const PASSWORD = process.env.APP_PASSWORD;
const OUT = join(process.cwd(), ".local-audits", "release-terminal");

type Scenario = {
  id: string;
  command: string;
  timeoutMs: number;
  /** Extra assertions on terminal text (case-insensitive substrings). */
  expectAny?: string[];
  expectAll?: string[];
  rejectAny?: string[];
};

const ALL: Scenario[] = [
  {
    id: "A_toronto_default",
    command: "find upcoming hackathons in Toronto --profile light --dry-run",
    timeoutMs: 180_000,
    expectAll: ["toronto", "light", "dry"],
    rejectAny: ["DEMO_MODE"],
  },
  {
    id: "B_toronto_or_remote",
    command:
      "find upcoming AI hackathons in Toronto or remote in the next 6 months --profile light --dry-run",
    timeoutMs: 180_000,
    expectAll: ["toronto", "remote", "dry"],
  },
  {
    id: "C_sf_default",
    command: "find upcoming hackathons in San Francisco --profile light --dry-run",
    timeoutMs: 180_000,
    expectAll: ["san francisco", "dry"],
  },
  {
    id: "D_sf_or_remote",
    command:
      "find upcoming hackathons in San Francisco or remote --profile standard --dry-run",
    timeoutMs: 240_000,
    expectAll: ["san francisco", "remote", "dry"],
  },
  {
    id: "E_explicit_dates",
    command:
      "find hackathons from 2026-08-01 to 2026-10-31 --profile standard --dry-run",
    timeoutMs: 240_000,
    expectAll: ["2026-08-01", "2026-10-31", "dry"],
  },
  {
    id: "F_no_location",
    command: "find upcoming hackathons in the next 3 months --profile standard --dry-run",
    timeoutMs: 240_000,
    expectAll: ["dry"],
    expectAny: ["3 month", "next 3", "dates:"],
  },
  {
    id: "G_canada_eligibility",
    command:
      "find hackathons that people in Canada are eligible for in the next 6 months --profile deep --dry-run",
    timeoutMs: 480_000,
    expectAll: ["canada", "dry"],
  },
  {
    id: "H_devpost_deep",
    command:
      "find AI hackathons from Devpost in the next 6 months --profile deep --dry-run",
    timeoutMs: 600_000,
    expectAll: ["devpost", "dry"],
  },
  {
    id: "I_luma_deep",
    command: "find AI hackathons from Luma in the next 6 months --profile deep --dry-run",
    timeoutMs: 600_000,
    expectAll: ["luma", "dry"],
  },
  {
    id: "J_reskilll",
    command:
      "find upcoming hackathons from Reskilll in the next 12 months --profile deep --dry-run",
    timeoutMs: 600_000,
    expectAll: ["dry"],
  },
  {
    id: "K_hackathons_space",
    command:
      "find upcoming hackathons from hackathons.space in the next 12 months --profile light --dry-run",
    timeoutMs: 300_000,
    expectAll: ["dry"],
  },
  {
    id: "K_taikai",
    command:
      "find upcoming hackathons from Taikai in the next 12 months --profile light --dry-run",
    timeoutMs: 300_000,
    expectAll: ["dry"],
  },
  {
    id: "K_eventornado",
    command:
      "find upcoming hackathons from Eventornado in the next 12 months --profile light --dry-run",
    timeoutMs: 300_000,
    expectAll: ["dry"],
  },
  {
    id: "K_dorahacks",
    command:
      "find upcoming hackathons from DoraHacks in the next 12 months --profile light --dry-run",
    timeoutMs: 180_000,
    expectAll: ["dry"],
  },
  {
    id: "P_persist_toronto",
    command: "find upcoming hackathons in Toronto --profile light",
    timeoutMs: 240_000,
    expectAll: ["toronto", "light"],
  },
  {
    id: "P_persist_toronto_rerun",
    command: "find upcoming hackathons in Toronto --profile light",
    timeoutMs: 240_000,
    expectAll: ["toronto"],
  },
];

function parseOnly(): Set<string> | null {
  const arg = process.argv.find((a) => a.startsWith("--only="));
  if (!arg) return null;
  return new Set(
    arg
      .slice("--only=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

async function login(page: Page): Promise<void> {
  if (!PASSWORD) throw new Error("APP_PASSWORD is required");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/owner password|password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 30_000,
  });
}

function commandInput(page: Page) {
  return page.locator("#discovery-terminal-input");
}

async function ensureTerminal(page: Page): Promise<void> {
  await page.goto(`${BASE}/terminal`, { waitUntil: "networkidle" });
  await commandInput(page).waitFor({ timeout: 30_000 });
  const banner = page.getByText(/Demo mode active|Development mock candidates/i);
  if (await banner.count()) {
    throw new Error("Demo/mock banner visible — DEMO_MODE/USE_MOCK_CANDIDATES must be off");
  }
}

async function submitInput(page: Page): Promise<void> {
  const run = page.getByRole("button", { name: /run command|starting run/i });
  if (await run.count()) {
    await run.click();
    return;
  }
  await commandInput(page).press("Enter");
}

async function runSiteSave(page: Page, name: string, url: string): Promise<void> {
  const input = commandInput(page);
  await input.fill(`/site save ${name} --url=${url}`);
  await submitInput(page);
  await page.waitForTimeout(3_000);
}

async function clearTerminal(page: Page): Promise<void> {
  const input = commandInput(page);
  await input.fill("/clear");
  await submitInput(page);
  await page.waitForTimeout(500);
}

async function waitForJobTerminal(
  page: Page,
  jobId: string,
  timeoutMs: number,
): Promise<{ status: string; summary: unknown }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate(async (id) => {
      const response = await fetch(`/api/discovery/jobs/${id}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        return { status: `http_${response.status}`, summary: null };
      }
      const json = (await response.json()) as {
        data?: { job?: { status?: string; summary?: unknown } };
      };
      return {
        status: json.data?.job?.status ?? "unknown",
        summary: json.data?.job?.summary ?? null,
      };
    }, jobId);
    if (
      ["completed", "failed", "cancelled", "canceled"].includes(
        String(result.status).toLowerCase(),
      )
    ) {
      return result;
    }
    await page.waitForTimeout(2_000);
  }
  return { status: "timeout", summary: null };
}

async function runCommand(
  page: Page,
  scenario: Scenario,
): Promise<{
  text: string;
  durationMs: number;
  pass: boolean;
  reasons: string[];
  jobStatus?: string;
  jobSummary?: unknown;
}> {
  await clearTerminal(page);
  const input = commandInput(page);
  await input.fill(scenario.command);
  const started = Date.now();

  const jobResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/discovery/jobs") &&
      response.request().method() === "POST" &&
      response.status() < 500,
    { timeout: 60_000 },
  );
  await submitInput(page);

  let jobId: string | null = null;
  try {
    const jobResponse = await jobResponsePromise;
    const payload = (await jobResponse.json()) as {
      data?: { job?: { id?: string } };
    };
    jobId = payload.data?.job?.id ?? null;
  } catch {
    jobId = null;
  }

  let jobStatus = "unknown";
  let jobSummary: unknown = null;
  if (jobId) {
    const waited = await waitForJobTerminal(page, jobId, scenario.timeoutMs);
    jobStatus = waited.status;
    jobSummary = waited.summary;
  } else {
    // Fallback for non-job commands: wait for UI idle.
    await page.waitForTimeout(5_000);
  }

  // Give the Terminal UI a moment to render the completion lines.
  await page.waitForTimeout(1_500);
  const durationMs = Date.now() - started;
  const text = ((await page.locator("body").innerText()) || "") as string;
  const lower = text.toLowerCase();
  const reasons: string[] = [];

  for (const needle of scenario.expectAll ?? []) {
    if (!lower.includes(needle.toLowerCase())) {
      reasons.push(`missing expected: ${needle}`);
    }
  }
  if (scenario.expectAny?.length) {
    if (!scenario.expectAny.some((n) => lower.includes(n.toLowerCase()))) {
      reasons.push(`missing any of: ${scenario.expectAny.join(", ")}`);
    }
  }
  for (const needle of scenario.rejectAny ?? []) {
    if (lower.includes(needle.toLowerCase())) {
      reasons.push(`found forbidden: ${needle}`);
    }
  }

  if (scenario.command.includes("--dry-run")) {
    const summaryObj = jobSummary as {
      dryRun?: boolean;
      created?: number;
      wouldCreate?: number;
    } | null;
    // Job API mirrors wouldCreate into created for dry-run display counts.
    if (summaryObj && summaryObj.dryRun === false) {
      reasons.push("job summary dryRun=false for dry-run command");
    }
    if (!/dry/i.test(text) && !/would create/i.test(text)) {
      reasons.push("dry-run markers not clearly visible");
    }
    if (
      /\[persistence\].*created=[1-9]/i.test(text) &&
      !/dry-run persistence/i.test(text)
    ) {
      reasons.push("persistence line suggests non-zero writes during dry-run");
    }
  } else if (jobId && !["completed", "failed"].includes(jobStatus.toLowerCase())) {
    reasons.push(`job did not complete (status=${jobStatus})`);
  }

  if (!scenario.command.includes("--dry-run") && scenario.id.startsWith("P_")) {
    const summaryObj = jobSummary as {
      dryRun?: boolean;
      created?: number;
      updated?: number;
      wouldCreate?: number;
    } | null;
    if (summaryObj?.dryRun === true) {
      reasons.push("persistence run unexpectedly marked dryRun=true");
    }
    if (/\[query\]\s*Dry-run:\s*yes/i.test(text)) {
      reasons.push("query interpretation still shows Dry-run: yes");
    }
    if (scenario.id === "P_persist_toronto_rerun") {
      if (typeof summaryObj?.created === "number" && summaryObj.created > 0) {
        reasons.push(`rerun created=${summaryObj.created}; expected 0`);
      }
    }
  }

  if (jobId && jobStatus === "timeout") {
    reasons.push("timed out waiting for job completion");
  }

  return {
    text,
    durationMs,
    pass: reasons.length === 0,
    reasons,
    jobStatus,
    jobSummary,
  };
}

async function cancelSmoke(page: Page): Promise<{ pass: boolean; text: string; durationMs: number }> {
  const input = commandInput(page);
  await input.fill(
    "find upcoming AI hackathons in Toronto or remote in the next 6 months --profile deep --dry-run",
  );
  const started = Date.now();
  await submitInput(page);
  await page.waitForTimeout(4_000);
  await input.fill("/cancel");
  await submitInput(page);
  await page.waitForTimeout(8_000);
  const text = await page.locator("body").innerText();
  const lower = text.toLowerCase();
  const pass = lower.includes("cancel");
  return { pass, text, durationMs: Date.now() - started };
}

async function main(): Promise<number> {
  mkdirSync(OUT, { recursive: true });
  const only = parseOnly();
  const scenarios = only
    ? ALL.filter((s) => [...only].some((id) => s.id.startsWith(id) || s.id === id))
    : ALL;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const results: Array<Record<string, unknown>> = [];

  try {
    await login(page);
    await page.goto(`${BASE}/queue`, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(OUT, "00_queue.png"), fullPage: true });
    await ensureTerminal(page);
    await page.screenshot({ path: join(OUT, "00_terminal.png"), fullPage: true });

    // Ensure Reskilll + other custom directories exist via product site flow.
    await runSiteSave(page, "Reskilll", "https://reskilll.com/allhacks");
    await runSiteSave(page, "hackathons.space", "https://hackathons.space/");
    await runSiteSave(page, "Taikai", "https://taikai.network/hackathons");
    await runSiteSave(page, "Eventornado", "https://eventornado.com/");
    await runSiteSave(page, "DoraHacks", "https://dorahacks.io/hackathon");
    await page.screenshot({ path: join(OUT, "00_sites.png"), fullPage: true });

    for (const scenario of scenarios) {
      console.log(`\n=== ${scenario.id} ===`);
      console.log(`command: ${scenario.command}`);
      await ensureTerminal(page);
      // Prefer a fresh session when possible.
      const newBtn = page.getByRole("button", { name: /new/i }).first();
      if (await newBtn.count()) {
        await newBtn.click().catch(() => undefined);
        await page.waitForTimeout(500);
      }
      const result = await runCommand(page, scenario);
      await page.screenshot({
        path: join(OUT, `${scenario.id}.png`),
        fullPage: true,
      });
      writeFileSync(
        join(OUT, `${scenario.id}.txt`),
        result.text.slice(-20_000),
        "utf8",
      );
      const summary = {
        id: scenario.id,
        command: scenario.command,
        durationMs: result.durationMs,
        pass: result.pass,
        reasons: result.reasons,
        jobStatus: result.jobStatus,
        jobSummary: result.jobSummary,
        writes: scenario.command.includes("--dry-run") ? 0 : "see-log",
        excerpt: result.text
          .split(/\n/)
          .filter((line) =>
            /query|theme|location|remote|profile|dry|would create|created|updated|devpost|luma|custom|blocked|cancel|persistence|directory|inventory|eligible/i.test(
              line,
            ),
          )
          .slice(0, 80),
      };
      results.push(summary);
      console.log(
        `result: ${result.pass ? "PASS" : "FAIL"} duration_ms=${result.durationMs}`,
      );
      if (result.reasons.length) console.log(`reasons: ${result.reasons.join("; ")}`);
    }

    if (!only || only.has("CANCEL")) {
      console.log("\n=== CANCEL_SMOKE ===");
      await ensureTerminal(page);
      const cancel = await cancelSmoke(page);
      await page.screenshot({ path: join(OUT, "CANCEL_smoke.png"), fullPage: true });
      writeFileSync(join(OUT, "CANCEL_smoke.txt"), cancel.text.slice(-12_000), "utf8");
      results.push({
        id: "CANCEL_smoke",
        command: "deep dry-run then /cancel",
        durationMs: cancel.durationMs,
        pass: cancel.pass,
        reasons: cancel.pass ? [] : ["cancel acknowledgement not found"],
      });
      console.log(`result: ${cancel.pass ? "PASS" : "FAIL"}`);
    }
  } finally {
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(results, null, 2), "utf8");
    await browser.close();
  }

  const failed = results.filter((r) => r.pass === false);
  console.log(`\n=== SUMMARY ${results.length - failed.length}/${results.length} passed ===`);
  console.log(`artifacts: ${OUT}`);
  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
