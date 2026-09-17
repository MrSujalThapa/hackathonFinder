import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type RuntimeServiceStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "retrying"
  | "stopped";

/**
 * Best-effort readiness signal for supervised workers.
 *
 * The supervisor owns `.data/hackfinder-runtime-state.json` and only writes
 * it on worker transitions (launch/exit). Workers merge their own service key
 * so a long-lived worker (e.g. the Discord Gateway) can report `running`
 * after it connects instead of reading `starting` forever.
 */
export function markRuntimeService(
  name: string,
  status: RuntimeServiceStatus,
  detail?: string,
  root: string = process.cwd(),
): void {
  try {
    mkdirSync(join(root, ".data"), { recursive: true });
    const statePath = join(root, ".data", "hackfinder-runtime-state.json");
    let state: {
      pid?: number;
      startedAt?: string;
      services?: Record<string, { status: string; updatedAt: string; detail?: string }>;
    } = {};
    if (existsSync(statePath)) {
      try {
        state = JSON.parse(readFileSync(statePath, "utf8")) as typeof state;
      } catch {
        state = {};
      }
    }
    state.services = state.services ?? {};
    state.services[name] = {
      status,
      updatedAt: new Date().toISOString(),
      ...(detail ? { detail } : {}),
    };
    writeFileSync(statePath, JSON.stringify(state));
  } catch {
    // Readiness is diagnostic only; never fail the worker for it.
  }
}
