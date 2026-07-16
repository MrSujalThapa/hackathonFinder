# Discovery production runbook

Operational guide for the post-overhaul scraper. No secrets belong in this file.

## Required environment

| Variable | Role |
|---|---|
| Supabase URL + service key | Candidate/evidence storage |
| `OPENAI_API_KEY` (or configured LLM provider) | Verification + custom AI group selection |
| Browser / Playwright deps | Luma, Hakku, custom growth pages |
| Google Sheets creds | **Approve/sync only** — not discovery writes |

Unset `PERSISTENCE_STRATEGY` in normal deployments (batch is default).

## LLM unavailable

Custom deterministic extraction still runs. If AI group selection is required
and LLM is down, the source reports `ai_unavailable` / degraded — **no silent
V1 fallback**.

## Browser

- Playwright for interactive directories
- Persistent Hakku profile under `.data/browser-profiles/` (local only)
- Cancelled jobs must release browser sessions (pipeline cancellation path)

## Timeouts and concurrency

| Knob | Typical |
|---|---|
| `DISCOVERY_JOB_TIMEOUT_MS` | 600000 |
| `DISCOVERY_PUBLIC_SOURCE_CONCURRENCY` | 3 |
| `DISCOVERY_MAX_ACTIVE_JOBS` | 2 |
| Per-source collector timeouts | source-owned (Devpost/Luma/custom) |

Do not raise crawl budgets to “fix” timeouts — investigate source health.

## Cancellation

- Listing cancel → no persistence writes; one terminal `cancelled` event
- Enrichment cancel → retain honest progress; no further collectors
- Persistence cancel → report write progress honestly; retries stay idempotent

## Blocked / auth sources

| Class | Behavior |
|---|---|
| DoraHacks / human verification | `blocked_human_verification`, 0 leads, no retry loop |
| Hakku auth wall | authenticated session or explicit auth failure |
| Origin / redirect unsafe | crawl-plan invalidation; fail closed |

## Telemetry

- Compact per-source telemetry ≤ ~2KB
- Job events: coalesced progress; completion/failure never dropped
- Local probes may write `.local-audits/` — **gitignored**; do not commit traces

## Batch persistence failures

- Partial failure returns errors + `writeProgress` (not clean success)
- Safe order: candidates → evidence → actions
- Rerun identical input: expect creates=0 (idempotent)
- Owner (`status`, approve/reject/save timestamps) and Sheets fields stay protected

## Safe rerun

1. Prefer `--dry-run` for interpretation / inventory checks
2. Narrow source list for controlled writes
3. Rerun same command: expect zero duplicate creates
4. Confirm Queue refresh is targeted (real run) or skipped (dry-run)

## Deferred rollback (soak incomplete)

As of C4 cutover day **2026-07-16**:

| Legacy | Normal reachability | Emergency | Delete after |
|---|---|---|---|
| Custom V1 collector (`src/collectors/customSource.ts` V1 body) | **Unreachable** (kernel always) | Flags ignored since B4 | Calendar **2026-07-30** **or** 3 controlled live custom runs on ≥3 distinct days after B2 (`578e332` / 2026-07-16) with no severity-1 regression |
| `V1PersistenceStrategy` | Unreachable unless emergency flag | `PERSISTENCE_ROLLBACK_V1=1` (dev/test only, logged) | Same calendar/run standard after C1 (`c307a2c` / 2026-07-16) + idempotency A–E green |

Never enable emergency persistence rollback in production.

## Logs

- Terminal job events via `/api/discovery/jobs/[id]/events?cursor=`
- CLI agent stdout (`[storage]`, `[complete]`, source lines)
- Probe JSON under `.local-audits/traces/` (local)

## Related docs

- `docs/discovery/FINAL_ARCHITECTURE.md`
- `docs/discovery/TEST_CONTRACTS.md`
- `docs/discovery/C4_FINAL_SOAK_REPORT.md`
