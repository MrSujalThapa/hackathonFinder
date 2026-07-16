# C2 Report — Pipeline performance

**Branch:** `experiment/scraper-overhaul-c2-pipeline-performance`  
**Base:** `c307a2c` (C1 batch-only persistence)  
**HEAD:** recorded at push  
**Date:** 2026-07-16

## 1. Branch / base

| Item | Value |
|---|---|
| Branch | `experiment/scraper-overhaul-c2-pipeline-performance` |
| Exact base | `c307a2c57130fba75d102edf5cba47876189f9a2` |

## 2. Baseline scenario timings (after C2, dry-run)

From `scripts/c2-pipeline-performance-probe.ts` → `.local-audits/traces/c2-pipeline-performance/`:

| Scenario | Duration | Events | Progress events | Event bytes | Coalesce emit/raw | Raw leads |
|---|---|---|---|---|---|---|
| light-strict | 35.7s | 67 | 41 | 32.7KB | 0.364 | 215 |
| deep-remote | 43.9s | 93 | 67 | 42.5KB | 0.176 | 728 |
| devpost-deep | 19.6s | 53 | 37 | 23.5KB | 0.116 | 500 |
| luma-deep | 25.8s | 32 | 16 | 14.4KB | 0.458 | 13* |

\* Luma deep via filtered discovery command; collector-level B3 probe still ≥100.

Pre-C2 progress volume was approximately **rawCallbacks** (1:1 logger→event). Measured emit/raw ratios imply **54–88% fewer** collector progress events retained.

Additional structural cuts vs pre-C2:

- ~6–8 query `source_progress` lines → 1 `query_interpreted` (+ 2 compact budget lines)
- up to 20 per-candidate result events with full payloads → 1 `result_summary_updated`
- persistence summary uses `persistence_completed` (compact counters)

## 3. Stage-budget model

`stageBudgetForProfile` — soft guidance only; listing remains source-owned.

## 4. Event vocabulary

`run_started`, `query_interpreted`, `source_started`, `source_progress` (coalesced), `source_completed` / degraded / auth, `enrichment_started`, `verification_started`, `dedupe_completed`, `result_summary_updated`, `persistence_started`, `persistence_completed`, `run_completed` / failed / cancelled.

## 5. Event count/bytes

| Metric | Before (model) | After (measured) |
|---|---|---|
| Collector progress | ≈ rawCallbacks | emit/raw 0.12–0.46 |
| Candidate preview events | up to 20 + payloads | 0 (summary only) |
| Query interpretation | 6–8 events | 1 (+2 budget) |
| deep-remote total bytes | higher (payloads) | 42.5KB |

## 6. Polling before/after

| Before | After |
|---|---|
| SSE poll every 500ms + `getJob` every tick | Cursor `after`; backoff 0.5→2.5s; `getJob` only on terminal / sparse idle |
| JSON fallback returned events+full job | `?format=json&after=N` returns delta + `compactJobForPoll` |
| History events limit 200 | History events limit 80 |

## 7. Job-summary payload

Job summary still holds `acceptedCandidates` for Terminal final formatting.  
`run_completed` **event** metadata no longer embeds full candidate objects (preview names only).

## 8. Queue/cache invalidation

| Case | Behavior |
|---|---|
| Dry-run completed | **no** `fetchCandidates` / Queue refresh |
| Real completed | Queue refresh **once** |
| Sheets / Settings / History | unchanged (not touched on progress) |

## 9. Source/detail concurrency

- Source concurrency: unchanged (`DISCOVERY_PUBLIC_SOURCE_CONCURRENCY`)
- Shared enrichment concurrency: profile-guided 3–4 (was fixed 4)
- Detail page **counts**: still source-owned profile budgets (unchanged)

## 10. In-run caching/dedupe

`enrichPromisingLeads`: one fetch per enrichment target URL within a run.

## 11. Cancellation

Unchanged contract: signal through collectors/enrichment/persistence assert; `run_cancelled` terminal; SSE ends on cancelled status.

## 12. Failure isolation

Unchanged: per-source failures stay in collector results; aggregation keeps healthy sources.

## 13. Persistence

C1 batch-only path unchanged. Added `persistence_completed` compact event. DB calls remain O(chunks).

## 14. Endpoint response sizes

- Event stream: compact events, no candidate payloads in progress
- JSON poll: cursor deltas
- History: fewer events per job (80)

## 15. Scenarios A–E

| Scenario | Result |
|---|---|
| A light dry-run | Progressive events; stored writes none to DB; no Queue invalidation path |
| B deep remote | Devpost 500 in probe path; coalescing active; completion events retained |
| C source failure | Existing isolation + force-flush on blocked phrases |
| D cancellation | Existing abort + terminal event |
| E controlled persistence | Batch strategy + `persistence_completed`; real-run Queue refresh only |

## 16. Regression probes

| Probe | Result |
|---|---|
| Devpost light | **75** |
| Devpost deep | **500** |
| Luma deep (B3) | **130** |
| C2 discovery thresholds | unchanged |

## 17. Tests / build

| Command | Result |
|---|---|
| typecheck | pass |
| check | pass |
| test | pass |
| test:scraper | pass |
| test:integration | pass |
| test:deterministic | pass |
| build | pass (via check) |

## 18. Remaining limitations

- Live wall-clock still dominated by source I/O (Luma/Devpost), not event plumbing
- SSE still polls store (no push from writer); backoff mitigates
- Job.summary still carries acceptedCandidates for Terminal formatting
- No isolated DB persistence soak in this phase (C1 covered batch)

## 19. Gate

**PASS** — event/poll/invalidation efficiency improved; recall probes green; batch persistence unchanged; no migration.

## 20. Commits

1. `cb2187f` perf(discovery): coalesce compact progress events  
2. `5b4b0cc` perf(terminal): poll discovery jobs incrementally  
3. `376a214` perf(terminal): target cache invalidation after runs  
4. `5106433` perf(discovery): bound detail enrichment concurrency  
5. `135347b` test(discovery): verify progressive performance contracts  
6. `6726bd6` docs(discovery): record C2 pipeline performance results  

Pushed: `origin/experiment/scraper-overhaul-c2-pipeline-performance` @ `6726bd6`

## 21. Exclusions

No C3, no V1 deletion (persistence or custom collector), no migration, no deploy, no X, no merge, no main push.
