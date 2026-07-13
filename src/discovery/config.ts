import { z } from "zod";

export type DiscoveryExecutionMode = "local" | "worker";

export type DiscoveryRuntimeConfig = {
  executionMode: DiscoveryExecutionMode;
  workerSharedSecret: string | undefined;
  browserProfileRoot: string | undefined;
  /** Max concurrently executing discovery jobs. */
  maxActiveJobs: number;
  /** Max jobs waiting for an execution slot. */
  maxQueuedJobs: number;
  /** Bounded concurrency for public (non-Hakku) collectors. */
  publicSourceConcurrency: number;
  /** Max wait for a per-source lock before degrading that source. */
  sourceLockWaitMs: number;
  jobTimeoutMs: number;
  eventRetentionDays: number;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function readDiscoveryRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): DiscoveryRuntimeConfig {
  const modeRaw = (env.DISCOVERY_EXECUTION_MODE ?? "local").trim().toLowerCase();
  const executionMode: DiscoveryExecutionMode =
    modeRaw === "worker" ? "worker" : "local";

  return {
    executionMode,
    workerSharedSecret: env.WORKER_SHARED_SECRET?.trim() || undefined,
    browserProfileRoot: env.BROWSER_PROFILE_ROOT?.trim() || undefined,
    maxActiveJobs: parsePositiveInt(env.DISCOVERY_MAX_ACTIVE_JOBS, 2),
    maxQueuedJobs: parsePositiveInt(env.DISCOVERY_MAX_QUEUED_JOBS, 10),
    publicSourceConcurrency: parsePositiveInt(
      env.DISCOVERY_PUBLIC_SOURCE_CONCURRENCY,
      3,
    ),
    sourceLockWaitMs: parsePositiveInt(
      env.DISCOVERY_SOURCE_LOCK_WAIT_MS,
      60_000,
    ),
    jobTimeoutMs: parsePositiveInt(env.DISCOVERY_JOB_TIMEOUT_MS, 10 * 60_000),
    eventRetentionDays: parsePositiveInt(env.DISCOVERY_EVENT_RETENTION_DAYS, 14),
  };
}

/**
 * Local in-process execution is for development / manual testing.
 * Unsupported production hosts (e.g. serverless) should use worker mode.
 */
export function assertLocalExecutionAllowed(
  config: DiscoveryRuntimeConfig = readDiscoveryRuntimeConfig(),
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (config.executionMode !== "local") return;

  const isVercel = Boolean(env.VERCEL);
  const isProduction =
    env.NODE_ENV === "production" || env.VERCEL_ENV === "production";

  if (isVercel && isProduction) {
    throw new Error(
      "DISCOVERY_EXECUTION_MODE=local is not supported on Vercel production. Set DISCOVERY_EXECUTION_MODE=worker and run the discovery worker.",
    );
  }
}

export const createJobBodySchema = z.object({
  command: z.string().trim().min(1).max(2_000),
  sources: z.array(z.string().min(1)).max(12).optional(),
  dryRun: z.boolean().optional(),
  maxAgentCalls: z.coerce.number().int().min(1).max(24).optional(),
  mode: z.enum(["auto", "agent", "deterministic"]).optional(),
  allSources: z.boolean().optional(),
});

export type CreateJobBody = z.infer<typeof createJobBodySchema>;
