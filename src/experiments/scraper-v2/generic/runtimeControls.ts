import type { ClassifiedFailure } from "@/experiments/scraper-v2/generic/types";

export class CancelledError extends Error {
  constructor(message = "operation cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

export function classifyFailure(error: unknown, stage: string): ClassifiedFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CancelledError || /abort|cancel/i.test(message)) {
    return { stage, classification: "cancelled", message, retryable: false };
  }
  if (/timeout|timed out/i.test(message)) return { stage, classification: "timeout", message, retryable: true };
  if (/429|rate limit/i.test(message)) return { stage, classification: "rate_limited", message, retryable: true };
  if (/403|401|blocked|captcha/i.test(message)) return { stage, classification: "blocked", message, retryable: false };
  if (/payload|too large|body size/i.test(message)) {
    return { stage, classification: "payload_too_large", message, retryable: false };
  }
  if (/network|ECONN|ENOTFOUND|ETIMEDOUT|socket/i.test(message)) {
    return { stage, classification: "network_transient", message, retryable: true };
  }
  return { stage, classification: "unknown", message, retryable: false };
}

export async function boundedMap<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current] as T, current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return results;
}

export class HostConcurrencyLimiter {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(private readonly perHostLimit: number) {}

  async run<T>(hostKey: string, task: () => Promise<T>): Promise<T> {
    await this.acquire(hostKey);
    try {
      return await task();
    } finally {
      this.release(hostKey);
    }
  }

  private async acquire(hostKey: string): Promise<void> {
    const active = this.active.get(hostKey) ?? 0;
    if (active < this.perHostLimit) {
      this.active.set(hostKey, active + 1);
      return;
    }
    await new Promise<void>((resolve) => {
      const queue = this.waiting.get(hostKey) ?? [];
      queue.push(resolve);
      this.waiting.set(hostKey, queue);
    });
    this.active.set(hostKey, (this.active.get(hostKey) ?? 0) + 1);
  }

  private release(hostKey: string): void {
    const active = Math.max(0, (this.active.get(hostKey) ?? 1) - 1);
    if (active === 0) this.active.delete(hostKey);
    else this.active.set(hostKey, active);
    const queue = this.waiting.get(hostKey) ?? [];
    const next = queue.shift();
    if (queue.length === 0) this.waiting.delete(hostKey);
    else this.waiting.set(hostKey, queue);
    next?.();
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  canAttempt(): boolean {
    if (this.failures < this.threshold) return true;
    return this.now() - this.openedAt >= this.cooldownMs;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryTransient<T>(input: {
  attempts: number;
  baseDelayMs: number;
  stage: string;
  signal?: AbortSignal;
  task: () => Promise<T>;
}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < input.attempts; attempt += 1) {
    throwIfCancelled(input.signal);
    try {
      return await input.task();
    } catch (error) {
      lastError = error;
      const failure = classifyFailure(error, input.stage);
      if (!failure.retryable || attempt === input.attempts - 1) break;
      const jitter = Math.floor(Math.random() * input.baseDelayMs);
      await sleep(input.baseDelayMs * 2 ** attempt + jitter);
    }
  }
  throw lastError;
}
