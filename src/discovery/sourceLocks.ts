/**
 * Per-source discovery locks.
 *
 * - Hakku (browser profile): exclusive lock — never two Chromium persistent
 *   contexts on the same profile directory.
 * - Public sources: shared bounded concurrency pool.
 *
 * Lock wait timeouts degrade that source only; they must not fail the whole run.
 */

import type { SourceName } from "@/core/discovery/types";
import { emptyCollectorResult, type CollectorResult } from "@/collectors/types";
import type { DiscoveryEventSink } from "@/discovery/events";
import { createEventEmitter } from "@/discovery/events";
import { resolveHakkuProfileName } from "@/lib/browser/profilePaths";
import type { CollectorTiming } from "@/discovery/performance";
import { performance } from "node:perf_hooks";

export class SourceLockTimeoutError extends Error {
  readonly source: SourceName;
  readonly code = "SOURCE_LOCK_TIMEOUT";

  constructor(source: SourceName, waitMs: number) {
    super(
      `Timed out after ${waitMs}ms waiting for ${source} lock — source skipped for this run`,
    );
    this.name = "SourceLockTimeoutError";
    this.source = source;
  }
}

export class SourceLockCancelledError extends Error {
  readonly source: SourceName;

  constructor(source: SourceName) {
    super(`Cancelled while waiting for ${source} lock`);
    this.name = "SourceLockCancelledError";
    this.source = source;
  }
}

type LockWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  abortHandler?: () => void;
  signal?: AbortSignal;
};

type SemaphoreState = {
  permits: number;
  max: number;
  waiters: LockWaiter[];
};

export type SourceLockAcquireOptions = {
  source: SourceName;
  signal?: AbortSignal;
  timeoutMs?: number;
  onWaiting?: () => void | Promise<void>;
  onAcquired?: () => void | Promise<void>;
};

export type CollectWithSourceLocksOptions = {
  runId?: string;
  eventSink?: DiscoveryEventSink;
  cancellationSignal?: AbortSignal;
  /** Max wait for a lock before degrading that source. */
  lockWaitTimeoutMs?: number;
  /** Override public pool size (tests / config). */
  publicConcurrency?: number;
  onCollectorTiming?: (timing: CollectorTiming) => void;
};

const DEFAULT_PUBLIC_CONCURRENCY = 3;
const DEFAULT_LOCK_WAIT_MS = 60_000;

const GLOBAL_KEY = "__hackathonFinderSourceLocks";

type LockHost = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, SemaphoreState>;
};

function lockMap(): Map<string, SemaphoreState> {
  const host = globalThis as LockHost;
  if (!host[GLOBAL_KEY]) {
    host[GLOBAL_KEY] = new Map();
  }
  return host[GLOBAL_KEY];
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function readPublicSourceConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readPositiveInt(
    env.DISCOVERY_PUBLIC_SOURCE_CONCURRENCY,
    DEFAULT_PUBLIC_CONCURRENCY,
  );
}

export function readSourceLockWaitTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readPositiveInt(env.DISCOVERY_SOURCE_LOCK_WAIT_MS, DEFAULT_LOCK_WAIT_MS);
}

/** Exclusive profile lock key — one Chromium context per profile name. */
export function hakkuProfileLockKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `profile:${resolveHakkuProfileName(env)}`;
}

export function sourceLockKey(source: SourceName): string {
  if (source === "hakku") return hakkuProfileLockKey();
  return "public-sources";
}

export function sourceLockMax(
  source: SourceName,
  publicConcurrency = readPublicSourceConcurrency(),
): number {
  if (source === "hakku") return 1;
  return publicConcurrency;
}

function getSemaphore(key: string, max: number): SemaphoreState {
  const map = lockMap();
  let state = map.get(key);
  if (!state) {
    state = { permits: max, max, waiters: [] };
    map.set(key, state);
    return state;
  }
  // Allow raising the pool size via env between runs; never shrink under active use.
  if (max > state.max) {
    state.permits += max - state.max;
    state.max = max;
  }
  return state;
}

function grant(state: SemaphoreState): () => void {
  state.permits -= 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.permits += 1;
    const next = state.waiters.shift();
    if (!next) return;
    clearWaiterTimer(next);
    detachAbort(next);
    next.resolve(grant(state));
  };
}

function clearWaiterTimer(waiter: LockWaiter): void {
  if (waiter.timer) clearTimeout(waiter.timer);
  waiter.timer = undefined;
}

function detachAbort(waiter: LockWaiter): void {
  if (waiter.signal && waiter.abortHandler) {
    waiter.signal.removeEventListener("abort", waiter.abortHandler);
  }
}

/**
 * Acquire a source lock. Always release via the returned function (use finally).
 * Cancel / abort while waiting rejects and removes the waiter (no leak).
 */
export async function acquireSourceLock(
  options: SourceLockAcquireOptions,
): Promise<() => void> {
  const max = sourceLockMax(options.source);
  const key = sourceLockKey(options.source);
  const state = getSemaphore(key, max);
  const timeoutMs = options.timeoutMs ?? readSourceLockWaitTimeoutMs();

  if (options.signal?.aborted) {
    throw new SourceLockCancelledError(options.source);
  }

  if (state.permits > 0) {
    return grant(state);
  }

  await options.onWaiting?.();

  return new Promise<() => void>((resolve, reject) => {
    const waiter: LockWaiter = {
      signal: options.signal,
      resolve: (release) => {
        void Promise.resolve(options.onAcquired?.())
          .then(() => resolve(release))
          .catch(() => resolve(release));
      },
      reject,
    };

    waiter.abortHandler = () => {
      const index = state.waiters.indexOf(waiter);
      if (index < 0) return;
      state.waiters.splice(index, 1);
      clearWaiterTimer(waiter);
      detachAbort(waiter);
      reject(new SourceLockCancelledError(options.source));
    };

    if (options.signal) {
      options.signal.addEventListener("abort", waiter.abortHandler, { once: true });
    }

    waiter.timer = setTimeout(() => {
      const index = state.waiters.indexOf(waiter);
      if (index < 0) return;
      state.waiters.splice(index, 1);
      detachAbort(waiter);
      reject(new SourceLockTimeoutError(options.source, timeoutMs));
    }, timeoutMs);

    state.waiters.push(waiter);
  });
}

export async function withSourceLock<T>(
  source: SourceName,
  fn: () => Promise<T>,
  options: Omit<SourceLockAcquireOptions, "source"> = {},
): Promise<T> {
  const release = await acquireSourceLock({ ...options, source });
  try {
    return await fn();
  } finally {
    release();
  }
}

function degradedLockResult(
  source: SourceName,
  startedAt: number,
  message: string,
): CollectorResult {
  const result = emptyCollectorResult(source, startedAt);
  result.warnings.push(message);
  result.errors.push(message);
  return result;
}

/**
 * Run collectors with per-source locks. One timed-out / cancelled lock wait
 * degrades that source only — other sources continue.
 */
export async function collectWithSourceLocks(
  sources: SourceName[],
  collectOne: (source: SourceName) => Promise<CollectorResult>,
  options: CollectWithSourceLocksOptions = {},
): Promise<CollectorResult[]> {
  const runId = options.runId ?? "source-locks";
  const emitter = createEventEmitter(runId, options.eventSink);
  const lockWaitTimeoutMs =
    options.lockWaitTimeoutMs ?? readSourceLockWaitTimeoutMs();
  const publicConcurrency =
    options.publicConcurrency ?? readPublicSourceConcurrency();

  // Ensure public pool is sized before parallel acquires.
  getSemaphore("public-sources", publicConcurrency);

  const results = await Promise.all(
    sources.map(async (source) => {
      const startedAt = Date.now();
      const submittedAtMs = performance.now();
      let release: (() => void) | undefined;
      try {
        release = await acquireSourceLock({
          source,
          signal: options.cancellationSignal,
          timeoutMs: lockWaitTimeoutMs,
          onWaiting: async () => {
            await emitter.emit(
              "source_progress",
              source === "hakku"
                ? "Waiting for authenticated browser slot..."
                : "Waiting for public source slot...",
              {
                source,
                level: "info",
                metadata: { lock: "waiting", lockKey: sourceLockKey(source) },
              },
            );
          },
          onAcquired: async () => {
            await emitter.emit(
              "source_progress",
              source === "hakku"
                ? "Browser slot acquired"
                : "Public source slot acquired",
              {
                source,
                metadata: { lock: "acquired", lockKey: sourceLockKey(source) },
              },
            );
          },
        });

        const acquiredAtMs = performance.now();
        const result = await collectOne(source);
        const endedAtMs = performance.now();
        options.onCollectorTiming?.({
          source,
          waitMs: acquiredAtMs - submittedAtMs,
          executionMs: endedAtMs - acquiredAtMs,
          totalMs: endedAtMs - submittedAtMs,
          rawLeadCount: result.diagnostics.discovered,
          returnedLeadCount: result.leads.length,
          outcome: result.status,
          diagnostics: {
            ...result.metrics,
            discovered: result.diagnostics.discovered,
            returned: result.diagnostics.returned,
            pagesTraversed: result.diagnostics.pagesTraversed ?? 0,
            detectedUnits: result.diagnostics.detectedUnits ?? 0,
            candidateUnits: result.diagnostics.candidateUnits ?? 0,
            normalizedLeads: result.diagnostics.normalizedLeads ?? 0,
          },
        });
        return result;
      } catch (error) {
        if (error instanceof SourceLockTimeoutError) {
          await emitter.emit("source_degraded", error.message, {
            source,
            level: "warning",
            metadata: { lock: "timeout", lockKey: sourceLockKey(source) },
          });
          const result = degradedLockResult(source, startedAt, error.message);
          const endedAtMs = performance.now();
          options.onCollectorTiming?.({
            source,
            waitMs: endedAtMs - submittedAtMs,
            executionMs: 0,
            totalMs: endedAtMs - submittedAtMs,
            rawLeadCount: 0,
            returnedLeadCount: 0,
            outcome: "timed out",
          });
          return result;
        }
        if (error instanceof SourceLockCancelledError) {
          if (options.cancellationSignal?.aborted) {
            const cancelled = new Error("Discovery run cancelled");
            cancelled.name = "DiscoveryCancelledError";
            throw cancelled;
          }
          const result = degradedLockResult(source, startedAt, error.message);
          const endedAtMs = performance.now();
          options.onCollectorTiming?.({
            source,
            waitMs: endedAtMs - submittedAtMs,
            executionMs: 0,
            totalMs: endedAtMs - submittedAtMs,
            rawLeadCount: 0,
            returnedLeadCount: 0,
            outcome: "degraded",
          });
          return result;
        }
        const result = emptyCollectorResult(source, startedAt);
        result.errors.push(
          error instanceof Error ? error.message : `Collector ${source} failed`,
        );
        const endedAtMs = performance.now();
        options.onCollectorTiming?.({
          source,
          waitMs: 0,
          executionMs: endedAtMs - submittedAtMs,
          totalMs: endedAtMs - submittedAtMs,
          rawLeadCount: 0,
          returnedLeadCount: 0,
          outcome: "failed",
        });
        return result;
      } finally {
        release?.();
      }
    }),
  );

  return results;
}

export function resetSourceLocksForTests(): void {
  lockMap().clear();
}

export function isSourceLockTimeoutError(error: unknown): boolean {
  return (
    error instanceof SourceLockTimeoutError ||
    (error instanceof Error && error.name === "SourceLockTimeoutError")
  );
}
