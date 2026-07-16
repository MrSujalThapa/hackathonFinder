import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CrawlMechanism, CrawlSourceState } from "@/crawl/types";

export const CUSTOM_CRAWL_PLAN_SCHEMA_VERSION = 1 as const;
export const CUSTOM_ADAPTER_VERSION = "b2-custom-1";
export const CUSTOM_CRAWL_PLAN_FAILURE_THRESHOLD = 3;

export type CustomCrawlPlanV1 = {
  schemaVersion: typeof CUSTOM_CRAWL_PLAN_SCHEMA_VERSION;
  mechanism: CrawlMechanism;
  allowedOrigins: string[];
  route: string;
  structuralSignature: string;
  pageFingerprint?: string;
  lastSuccessAt: string;
  observedInventory?: number;
  lastQuality: CrawlSourceState;
  consecutiveFailures: number;
  adapterVersion: string;
  kernelVersion: string;
};

export type CrawlPlanCacheStatus = "hit" | "miss" | "invalidated" | "absent";

export type CrawlPlanValidationResult =
  | { ok: true; plan: CustomCrawlPlanV1 }
  | { ok: false; reason: string; plan?: CustomCrawlPlanV1 };

function plansRoot(): string {
  return path.join(process.cwd(), ".data", "crawl-plans");
}

export function crawlPlanPath(slug: string): string {
  const safe = slug.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
  return path.join(plansRoot(), `${safe}.json`);
}

export function structuralSignatureFromShape(input: {
  unitTag?: string;
  unitCount?: number;
  mechanism: CrawlMechanism;
  sampleTitles?: string[];
}): string {
  const sample = (input.sampleTitles ?? []).slice(0, 3).join("|");
  const raw = `${input.mechanism}|${input.unitTag ?? "?"}|${input.unitCount ?? 0}|${sample}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export function shortPageFingerprint(html: string): string {
  return createHash("sha256")
    .update(html.replace(/\s+/g, " ").slice(0, 12_000))
    .digest("hex")
    .slice(0, 16);
}

export function isCustomCrawlPlan(value: unknown): value is CustomCrawlPlanV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.schemaVersion === CUSTOM_CRAWL_PLAN_SCHEMA_VERSION &&
    typeof plan.mechanism === "string" &&
    Array.isArray(plan.allowedOrigins) &&
    typeof plan.route === "string" &&
    typeof plan.structuralSignature === "string" &&
    typeof plan.lastSuccessAt === "string" &&
    typeof plan.lastQuality === "string" &&
    typeof plan.consecutiveFailures === "number" &&
    typeof plan.adapterVersion === "string" &&
    typeof plan.kernelVersion === "string"
  );
}

export function validateCrawlPlan(input: {
  plan: CustomCrawlPlanV1;
  requestedUrl: string;
  finalUrl: string;
  allowedOrigins: string[];
  structuralSignature?: string;
  blockedReason?: string;
}): CrawlPlanValidationResult {
  const { plan } = input;
  if (plan.schemaVersion !== CUSTOM_CRAWL_PLAN_SCHEMA_VERSION) {
    return { ok: false, reason: "schema_version_mismatch", plan };
  }
  if (plan.adapterVersion !== CUSTOM_ADAPTER_VERSION) {
    return { ok: false, reason: "adapter_version_mismatch", plan };
  }
  if (plan.consecutiveFailures >= CUSTOM_CRAWL_PLAN_FAILURE_THRESHOLD) {
    return { ok: false, reason: "consecutive_failure_threshold", plan };
  }
  if (input.blockedReason) {
    return { ok: false, reason: "blocked_or_auth", plan };
  }
  try {
    const requested = new URL(input.requestedUrl);
    const finalUrl = new URL(input.finalUrl);
    const planOriginOk = plan.allowedOrigins.some((origin) => {
      try {
        return new URL(origin).origin === finalUrl.origin;
      } catch {
        return false;
      }
    });
    const allowlistOk = input.allowedOrigins.some((origin) => {
      try {
        return new URL(origin).origin === finalUrl.origin;
      } catch {
        return false;
      }
    });
    if (!planOriginOk || !allowlistOk) {
      return { ok: false, reason: "origin_or_redirect_change", plan };
    }
    const route = requested.pathname.replace(/\/$/, "") || "/";
    if (plan.route !== route && plan.route !== finalUrl.pathname.replace(/\/$/, "")) {
      // Soft: route drift alone does not invalidate if origin matches and signature matches.
    }
  } catch {
    return { ok: false, reason: "invalid_url", plan };
  }
  if (
    input.structuralSignature &&
    plan.structuralSignature &&
    input.structuralSignature !== plan.structuralSignature
  ) {
    return { ok: false, reason: "missing_expected_structure", plan };
  }
  return { ok: true, plan };
}

export function shouldInvalidateAfterResult(input: {
  plan?: CustomCrawlPlanV1;
  sourceState: CrawlSourceState;
  stopReason: string;
  uniqueCards: number;
}): string | undefined {
  if (
    input.sourceState === "blocked_human_verification" ||
    input.sourceState === "blocked_authentication" ||
    input.sourceState === "acquisition_failed"
  ) {
    return input.sourceState;
  }
  if (
    input.plan &&
    typeof input.plan.observedInventory === "number" &&
    input.plan.observedInventory >= 10 &&
    input.uniqueCards === 0 &&
    (input.stopReason === "no_growth" || input.stopReason === "exhausted")
  ) {
    return "repeated_no_growth_against_healthy_inventory";
  }
  return undefined;
}

/** File-backed cache — optional and non-authoritative. Loss → fresh discovery. */
export async function loadCrawlPlan(slug: string): Promise<CustomCrawlPlanV1 | undefined> {
  try {
    const raw = await readFile(crawlPlanPath(slug), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isCustomCrawlPlan(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function saveCrawlPlan(slug: string, plan: CustomCrawlPlanV1): Promise<void> {
  await mkdir(plansRoot(), { recursive: true });
  await writeFile(crawlPlanPath(slug), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

export function buildCrawlPlan(input: {
  mechanism: CrawlMechanism;
  allowedOrigins: string[];
  route: string;
  structuralSignature: string;
  pageFingerprint?: string;
  observedInventory?: number;
  lastQuality: CrawlSourceState;
  consecutiveFailures?: number;
  kernelVersion: string;
}): CustomCrawlPlanV1 {
  return {
    schemaVersion: CUSTOM_CRAWL_PLAN_SCHEMA_VERSION,
    mechanism: input.mechanism,
    allowedOrigins: [...input.allowedOrigins],
    route: input.route,
    structuralSignature: input.structuralSignature,
    ...(input.pageFingerprint ? { pageFingerprint: input.pageFingerprint } : {}),
    lastSuccessAt: new Date().toISOString(),
    ...(typeof input.observedInventory === "number"
      ? { observedInventory: input.observedInventory }
      : {}),
    lastQuality: input.lastQuality,
    consecutiveFailures: input.consecutiveFailures ?? 0,
    adapterVersion: CUSTOM_ADAPTER_VERSION,
    kernelVersion: input.kernelVersion,
  };
}
