/**
 * Deterministic coalescing for noisy source_progress emissions.
 * Completion / failure / phase-change signals are never dropped.
 */

export type ProgressCoalescerStats = {
  rawCallbacks: number;
  emitted: number;
  coalesced: number;
  flushedForced: number;
};

export type ProgressCoalescerOptions = {
  /** Persist/emit a progress line. */
  emit: (message: string, metadata?: Record<string, unknown>) => void | Promise<void>;
  /** Minimum interval between coalesced emits (ms). */
  minIntervalMs?: number;
  /** Emit when this many raw callbacks accumulate since last emit. */
  countThreshold?: number;
  /** Optional now() for tests. */
  now?: () => number;
};

const FORCE_FLUSH_PATTERN =
  /\b(leads? found|lazy loading complete|blocked|failed|error|cancelled|complete[d]?|exhausted|starting\b)/i;

export function createProgressCoalescer(options: ProgressCoalescerOptions): {
  note: (message: string, metadata?: Record<string, unknown>) => void;
  flush: () => Promise<void>;
  /** Always emit pending + mark forced (source completion / failure). */
  flushForce: () => Promise<void>;
  stats: () => ProgressCoalescerStats;
} {
  const minIntervalMs = options.minIntervalMs ?? 750;
  const countThreshold = options.countThreshold ?? 8;
  const now = options.now ?? (() => Date.now());

  let rawCallbacks = 0;
  let emitted = 0;
  let coalesced = 0;
  let flushedForced = 0;
  let pendingMessage: string | null = null;
  let pendingMetadata: Record<string, unknown> | undefined;
  let sinceEmit = 0;
  let lastEmitAt = 0;
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (fn: () => Promise<void>) => {
    chain = chain.then(fn, fn);
    return chain;
  };

  const doEmit = async (message: string, metadata?: Record<string, unknown>) => {
    await options.emit(message, metadata);
    emitted += 1;
    lastEmitAt = now();
    sinceEmit = 0;
    pendingMessage = null;
    pendingMetadata = undefined;
  };

  const shouldForce = (message: string) => FORCE_FLUSH_PATTERN.test(message);

  return {
    note(message, metadata) {
      rawCallbacks += 1;
      sinceEmit += 1;
      const trimmed = message.trim();
      if (!trimmed) return;

      if (shouldForce(trimmed)) {
        void enqueue(async () => {
          if (pendingMessage && pendingMessage !== trimmed) {
            coalesced += 1;
            await doEmit(pendingMessage, pendingMetadata);
          }
          await doEmit(trimmed, metadata);
        });
        return;
      }

      if (pendingMessage && pendingMessage !== trimmed) {
        coalesced += 1;
      }
      pendingMessage = trimmed;
      pendingMetadata = metadata;

      const elapsed = now() - lastEmitAt;
      const dueByTime = lastEmitAt === 0 || elapsed >= minIntervalMs;
      const dueByCount = sinceEmit >= countThreshold;
      if (dueByTime || dueByCount) {
        void enqueue(async () => {
          if (!pendingMessage) return;
          await doEmit(pendingMessage, pendingMetadata);
        });
      }
    },

    async flush() {
      await enqueue(async () => {
        if (!pendingMessage) return;
        await doEmit(pendingMessage, pendingMetadata);
      });
    },

    async flushForce() {
      flushedForced += 1;
      await enqueue(async () => {
        if (!pendingMessage) return;
        await doEmit(pendingMessage, pendingMetadata);
      });
    },

    stats() {
      return {
        rawCallbacks,
        emitted,
        coalesced,
        flushedForced,
      };
    },
  };
}
