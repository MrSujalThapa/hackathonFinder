/**
 * In-process discovery job concurrency gate.
 *
 * Limits how many jobs run at once (DISCOVERY_MAX_ACTIVE_JOBS) and how many
 * may wait for a slot (DISCOVERY_MAX_QUEUED_JOBS). Excess admissions are rejected.
 */

import { readDiscoveryRuntimeConfig } from "@/discovery/config";

export type JobQueuePositionListener = (position: number) => void | Promise<void>;

export type JobConcurrencyAcquireOptions = {
  jobId: string;
  /** Called when the waiter’s 1-based queue position changes (0 = acquired / running). */
  onPosition?: JobQueuePositionListener;
  /** When true, remove from wait queue without running. */
  isCancelled?: () => boolean | Promise<boolean>;
  /** Abort while waiting — same as cancel. */
  signal?: AbortSignal;
};

export type JobConcurrencyRunOptions = JobConcurrencyAcquireOptions & {
  /** Optional override for max active runners (tests). */
  maxActive?: number;
};

export class DiscoveryJobQueueFullError extends Error {
  readonly code = "DISCOVERY_JOB_QUEUE_FULL";

  constructor(maxQueuedJobs: number) {
    super(
      `Discovery job queue is full (max ${maxQueuedJobs} waiting). Wait for a queued run to start or cancel one.`,
    );
    this.name = "DiscoveryJobQueueFullError";
  }
}

export class DiscoveryJobCancelledWhileQueuedError extends Error {
  constructor(jobId: string) {
    super(`Discovery job cancelled while queued: ${jobId}`);
    this.name = "DiscoveryJobCancelledWhileQueuedError";
  }
}

type Waiter = {
  jobId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  onPosition?: JobQueuePositionListener;
  isCancelled?: () => boolean | Promise<boolean>;
  signal?: AbortSignal;
  abortHandler?: () => void;
};

export type DiscoveryJobConcurrencyGate = {
  readonly activeCount: number;
  readonly waitingCount: number;
  /** Admit a job into the wait queue or start immediately. Throws if queue full. */
  acquire: (options: JobConcurrencyAcquireOptions) => Promise<() => void>;
  /** acquire → run → release. */
  run: <T>(
    options: JobConcurrencyRunOptions,
    fn: () => Promise<T>,
  ) => Promise<T>;
  /** Drop a waiting job (e.g. cancel). No-op if already running or unknown. */
  cancelWaiting: (jobId: string) => boolean;
  resetForTests: () => void;
};

function createGate(defaultMaxActive: () => number): DiscoveryJobConcurrencyGate {
  let active = 0;
  const waiters: Waiter[] = [];

  const notifyPositions = () => {
    waiters.forEach((waiter, index) => {
      void waiter.onPosition?.(index + 1);
    });
  };

  const detachSignal = (waiter: Waiter) => {
    if (waiter.signal && waiter.abortHandler) {
      waiter.signal.removeEventListener("abort", waiter.abortHandler);
    }
  };

  const removeWaiter = (waiter: Waiter): boolean => {
    const index = waiters.indexOf(waiter);
    if (index < 0) return false;
    waiters.splice(index, 1);
    detachSignal(waiter);
    notifyPositions();
    return true;
  };

  const promote = () => {
    const maxActive = defaultMaxActive();
    while (active < maxActive && waiters.length > 0) {
      const next = waiters.shift();
      if (!next) break;
      detachSignal(next);
      active += 1;
      void next.onPosition?.(0);
      next.resolve();
    }
    notifyPositions();
  };

  const release = () => {
    active = Math.max(0, active - 1);
    promote();
  };

  return {
    get activeCount() {
      return active;
    },
    get waitingCount() {
      return waiters.length;
    },

    async acquire(options: JobConcurrencyAcquireOptions): Promise<() => void> {
      const config = readDiscoveryRuntimeConfig();
      const maxActive = config.maxActiveJobs;
      const maxQueued = config.maxQueuedJobs;

      if (options.signal?.aborted || (await options.isCancelled?.())) {
        throw new DiscoveryJobCancelledWhileQueuedError(options.jobId);
      }

      if (active < maxActive && waiters.length === 0) {
        active += 1;
        await options.onPosition?.(0);
        return release;
      }

      if (waiters.length >= maxQueued) {
        throw new DiscoveryJobQueueFullError(maxQueued);
      }

      return new Promise<() => void>((resolveAcquire, rejectAcquire) => {
        const waiter: Waiter = {
          jobId: options.jobId,
          onPosition: options.onPosition,
          isCancelled: options.isCancelled,
          signal: options.signal,
          resolve: () => resolveAcquire(release),
          reject: rejectAcquire,
        };

        waiter.abortHandler = () => {
          if (!removeWaiter(waiter)) return;
          rejectAcquire(new DiscoveryJobCancelledWhileQueuedError(options.jobId));
        };

        if (options.signal) {
          options.signal.addEventListener("abort", waiter.abortHandler, {
            once: true,
          });
        }

        waiters.push(waiter);
        const position = waiters.indexOf(waiter) + 1;
        void options.onPosition?.(position);

        // Periodic cancel poll for store-driven cancel without AbortSignal.
        const poll = setInterval(() => {
          void (async () => {
            if (!(await options.isCancelled?.())) return;
            clearInterval(poll);
            if (!removeWaiter(waiter)) return;
            rejectAcquire(new DiscoveryJobCancelledWhileQueuedError(options.jobId));
          })();
        }, 250);

        const originalResolve = waiter.resolve;
        const originalReject = waiter.reject;
        waiter.resolve = () => {
          clearInterval(poll);
          originalResolve();
        };
        waiter.reject = (error) => {
          clearInterval(poll);
          originalReject(error);
        };

        // Another slot may have freed between the check and enqueue.
        promote();
      });
    },

    async run<T>(options: JobConcurrencyRunOptions, fn: () => Promise<T>): Promise<T> {
      const release = await this.acquire(options);
      try {
        return await fn();
      } finally {
        release();
      }
    },

    cancelWaiting(jobId: string): boolean {
      const waiter = waiters.find((item) => item.jobId === jobId);
      if (!waiter) return false;
      removeWaiter(waiter);
      waiter.reject(new DiscoveryJobCancelledWhileQueuedError(jobId));
      return true;
    },

    resetForTests() {
      for (const waiter of [...waiters]) {
        removeWaiter(waiter);
        waiter.reject(new DiscoveryJobCancelledWhileQueuedError(waiter.jobId));
      }
      active = 0;
    },
  };
}

const GLOBAL_KEY = "__hackathonFinderDiscoveryJobGate";

type GlobalGateHost = typeof globalThis & {
  [GLOBAL_KEY]?: DiscoveryJobConcurrencyGate;
};

export function getDiscoveryJobConcurrencyGate(): DiscoveryJobConcurrencyGate {
  const host = globalThis as GlobalGateHost;
  if (!host[GLOBAL_KEY]) {
    host[GLOBAL_KEY] = createGate(
      () => readDiscoveryRuntimeConfig().maxActiveJobs,
    );
  }
  return host[GLOBAL_KEY];
}

export function resetDiscoveryJobConcurrencyGateForTests(): void {
  getDiscoveryJobConcurrencyGate().resetForTests();
}

/** Running = claimed / in progress (excludes queued + terminal). */
export const RUNNING_JOB_STATUSES = [
  "planning",
  "collecting",
  "enriching",
  "verifying",
  "persisting",
] as const;

export type JobLoadSnapshot = {
  running: number;
  waiting: number;
  maxActiveJobs: number;
  maxQueuedJobs: number;
};

/**
 * Pre-admission check using store counts.
 * Waiting jobs may still be accepted until maxQueuedJobs is reached.
 */
export function assertJobQueueAdmission(
  load: Pick<JobLoadSnapshot, "waiting" | "maxQueuedJobs">,
): void {
  if (load.waiting >= load.maxQueuedJobs) {
    throw new DiscoveryJobQueueFullError(load.maxQueuedJobs);
  }
}

export function isDiscoveryJobQueueFullError(error: unknown): boolean {
  return (
    error instanceof DiscoveryJobQueueFullError ||
    (error instanceof Error &&
      (error.name === "DiscoveryJobQueueFullError" ||
        /job queue is full/i.test(error.message)))
  );
}

export function isDiscoveryJobCancelledWhileQueuedError(error: unknown): boolean {
  return (
    error instanceof DiscoveryJobCancelledWhileQueuedError ||
    (error instanceof Error && error.name === "DiscoveryJobCancelledWhileQueuedError")
  );
}
