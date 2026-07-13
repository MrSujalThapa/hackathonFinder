# Discovery concurrency & locking

Policy for overlapping discovery jobs and per-source collector execution.

## Job concurrency

| Knob | Env | Default | Behavior |
|---|---|---|---|
| Max active jobs | `DISCOVERY_MAX_ACTIVE_JOBS` | `2` | Max jobs executing at once (planning → persisting) |
| Max queued jobs | `DISCOVERY_MAX_QUEUED_JOBS` | `10` | Max jobs waiting for an execution slot |
| Job timeout | `DISCOVERY_JOB_TIMEOUT_MS` | `600000` | Abort a running job after this budget |

Admission:

1. If waiting jobs ≥ `DISCOVERY_MAX_QUEUED_JOBS` → reject create (`job queue is full`).
2. Otherwise create the job and emit `run_queued` with `queuePosition` metadata (`0` = can start immediately).
3. Local executor uses an in-process gate: excess jobs wait; position updates re-emit `run_queued`.
4. Cancel while waiting removes the waiter and does not start execution.

## Source locks

| Source class | Lock | Limit | Env |
|---|---|---|---|
| Hakku (browser profile) | Exclusive profile lock | **1** | Profile name via `HAKKU_PROFILE_NAME` |
| Public sources (mlh, web, hacklist, devpost, luma, …) | Shared pool | `3` | `DISCOVERY_PUBLIC_SOURCE_CONCURRENCY` |
| Lock wait budget | Per acquire | `60000` ms | `DISCOVERY_SOURCE_LOCK_WAIT_MS` |

Rules:

- Never open two Chromium persistent contexts on the same Hakku profile.
- Emit `source_progress` while waiting / when a waited lock is acquired.
- Always release locks in `finally`.
- Cancel / abort while waiting drops the waiter (no leak).
- **Lock timeout degrades that source only** (`source_degraded`) — the rest of the run continues.

## Events (queue / lock)

| Event | When |
|---|---|
| `run_queued` | Job created; also when wait-queue position changes (`metadata.queuePosition`) |
| `source_progress` | Waiting for or acquired a source lock (`metadata.lock`) |
| `source_degraded` | Source skipped after lock wait timeout |

## Why

Hakku’s Playwright `launchPersistentContext` cannot share a user-data dir. Job limits keep the owner machine / worker from stacking unbounded discovery runs. Public collectors still run in parallel, but capped to reduce burst load.
