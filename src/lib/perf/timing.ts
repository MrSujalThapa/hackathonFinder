/**
 * Development-only latency probes for the review workflow.
 * Never logs secrets or request/response payloads.
 */

type TimingBucket = {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
};

const buckets = new Map<string, TimingBucket>();

function isEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

function record(label: string, ms: number): void {
  if (!isEnabled() || !Number.isFinite(ms)) return;
  const existing = buckets.get(label) ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
  };
  existing.count += 1;
  existing.totalMs += ms;
  existing.lastMs = ms;
  existing.maxMs = Math.max(existing.maxMs, ms);
  buckets.set(label, existing);

  const avg = existing.totalMs / existing.count;
  // eslint-disable-next-line no-console
  console.debug(
    `[perf] ${label}: ${ms.toFixed(1)}ms (avg ${avg.toFixed(1)}ms, max ${existing.maxMs.toFixed(1)}ms, n=${existing.count})`,
  );
}

/** Time an async function and record under `label`. */
export async function timedAsync<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isEnabled()) {
    return fn();
  }
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(label, performance.now() - start);
  }
}

/** Time a sync function. */
export function timedSync<T>(label: string, fn: () => T): T {
  if (!isEnabled()) {
    return fn();
  }
  const start = performance.now();
  try {
    return fn();
  } finally {
    record(label, performance.now() - start);
  }
}

/** Manual mark pair for spans that cross callbacks. */
export function startMark(label: string): () => void {
  if (!isEnabled()) {
    return () => undefined;
  }
  const start = performance.now();
  return () => record(label, performance.now() - start);
}

export function getTimingSnapshot(): Record<
  string,
  { count: number; avgMs: number; maxMs: number; lastMs: number }
> {
  const out: Record<
    string,
    { count: number; avgMs: number; maxMs: number; lastMs: number }
  > = {};
  for (const [label, bucket] of buckets) {
    out[label] = {
      count: bucket.count,
      avgMs: bucket.totalMs / bucket.count,
      maxMs: bucket.maxMs,
      lastMs: bucket.lastMs,
    };
  }
  return out;
}

export function resetTimings(): void {
  buckets.clear();
}
