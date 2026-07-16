# C1 Report — Batch-only production persistence

**Branch:** `experiment/scraper-overhaul-c1-batch-only-persistence`  
**Base:** `138c2a2` (B4 `experiment/scraper-overhaul-b4-remove-obsolete-paths`)  
**Date:** 2026-07-16

## 1. Branch / base

| Item | Value |
|---|---|
| Branch | `experiment/scraper-overhaul-c1-batch-only-persistence` |
| Exact base | `138c2a2e1f22df4777a03415263fb024628910c8` |

## 2. Persistence routing before / after

| Env | Before (B4) | After (C1) |
|---|---|---|
| unset | **v1** | **batch** |
| `PERSISTENCE_STRATEGY=batch` | batch | batch |
| `PERSISTENCE_STRATEGY=v1` | v1 | **batch** + deprecation warning |
| invalid | v1 + warning | **batch** + warning |
| `PERSISTENCE_ROLLBACK_V1=1` | n/a | v1 emergency (logged) |

Pipeline label: `batch` (removed “experimental”).

## 3. V1 imports / reachability

| Symbol | Reachability |
|---|---|
| `V1PersistenceStrategy` | Defined in `strategies.ts`; constructed only when selection name is `v1` |
| Production selection | Never selects v1 unless `PERSISTENCE_ROLLBACK_V1` |
| Pipeline | Uses `selectPersistenceStrategyFromEnv` + `createPersistenceStrategy` only |
| `upsertCandidateByFingerprint` / `addEvidence` | Still used by V1 class body; not called on batch path |

## 4. Batch plan stages

1. `acceptedCandidatesToWriteSet`  
2. Chunked fingerprint lookup  
3. Chunked evidence lookup for existing IDs  
4. `planPersistence` (normalize, within-batch dedupe, create/update/unchanged)  
5. Chunked candidate inserts/updates  
6. Chunked evidence inserts/updates  
7. Chunked action inserts  
8. Optional post-write verify (`PERSISTENCE_BATCH_VERIFY_AFTER_WRITE`)  
9. Compact `formatPersistenceSummary`

## 5. Field-ownership protections

Never in update payload: `status`, `approved_at`, `rejected_at`, `saved_at`, `sheet_row_id`, `sheet_appended_at`.

Covered by contract tests in `batchOnly.c1.test.ts` + `strategies.test.ts`.

## 6. Identity lookup / dedupe

- Fingerprint-normalized write set  
- Within-batch merge by fingerprint  
- Single chunked `selectCandidatesByFingerprints` (default chunk 250)  
- Classify create / update / unchanged  
- No per-candidate existence loop on batch path  

## 7. Evidence dedupe

Identity: `candidate_id + type + url_key`.

Identical observations → update `seen_count` / `last_seen_at` (bookkeeping).  
Distinct type/URL evidence retained (Case E).

## 8. Idempotency A–E

| Case | Result |
|---|---|
| A identical rerun | created=0; no duplicate candidates/evidence |
| B one new event | created=1; owner/Sheets preserved |
| C source field change | intended update (score/prize); protected fields intact |
| D duplicate leads | one candidate create |
| E multi-source | one candidate; two evidence rows; merged source_ids |

Bookkeeping that may refresh: `last_verified`, evidence `last_seen_at` / `seen_count`.

## 9. Failure / retry

- No full multi-table DB transaction (Supabase REST limitation).  
- Safe order: candidates → evidence → actions.  
- Partial failure: `storageFailures` + errors + `writeProgress`; not reported as clean success.  
- Retry-safe via fingerprint / evidence identity.  
- Dry-run: zero repository calls.

## 10–11. DB calls / timings (fixture model)

Measured with counting adapter (chunk sizes 40/40/50).

| Fixture | V1 model (approx statements) | Batch measured calls |
|---|---|---|
| 10 creates (~1 evidence each) | ~20 (10 upsert + 10 evidence) | lookup≤1 + insert≤1 + evidence≤1 ≈ **3** |
| 100 creates | ~200 | lookup≤3 + insert≤3 + evidence≤3 ≈ **≤9** (test: all ≪ 100) |
| Identical rerun (1) | ~2 | lookup + optional evidence update; **0 inserts** |

Wall durations on mocked adapter are sub-50ms and not representative of network; production duration is emitted in `formatPersistenceSummary` (`duration_ms`, `db_calls`).

## 12. Controlled integration

Isolated mocked repository fixtures through `BatchPersistenceStrategy.persist` (same strategy class as Terminal jobs). No mutation of owner production data.

## 13. Dry-run

Contract: `wouldCreate` set; created=0; zero adapter write/lookup calls.

## 14. Compact telemetry

Example: `[persistence] strategy=batch created=… updated=… unchanged=… evidence=… actions=… failures=… db_calls=… duration_ms=…`

No candidate/evidence payloads in the summary line.

## 15. Discovery regression probes

| Probe | Result | Threshold |
|---|---|---|
| Devpost light | **75** | 50–100, near 75 |
| Devpost deep | **500** | ≥300, near 500 |
| Luma deep | **130** | ≥100 |
| hackathons.space | **30** | ~30 |
| Taikai | **40** | ~40 |
| DoraHacks | **blocked** (`blocked_human_verification`) | blocked |
| Dry-run MLH | Strategy **batch**, `db_calls=0`, stored=0 | write-free |

Collection behavior unchanged by C1.

## 16. Tests / build

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run check` (lint + typecheck + build) | pass |
| `npm test` | pass |
| `npm run test:scraper` | pass |
| `npm run test:integration` | pass |
| `npm run test:deterministic` | pass (794) |
| `npm run build` | pass (via check) |

## 17. Remaining V1 deletion blocker

`PERSISTENCE_V1_SOAK_BLOCKER` in `strategies.ts`. Implementation retained until C4 + soak evidence.  
**Not** the custom collector V1 (`src/collectors/customSource.ts`).

## 18. Gate

**PASS** — batch is the sole normal production writer; V1 unreachable without emergency flag; contracts A–E + suites + probes green.

## 19. Commits

1. `33e820b` refactor(persistence): make batch strategy production-only  
2. `d0de653` test(persistence): verify idempotency and protected fields  
3. `57e1d3d` perf(persistence): move batch benchmark out of production paths  
4. `b73e629` docs(discovery): document batch-only persistence architecture  
5. `2311109` chore(persistence): remove relocated batch benchmark from experiments  

Pushed: `origin/experiment/scraper-overhaul-c1-batch-only-persistence` @ `2311109`

## 20. Exclusions confirmed

No C2 optimization, no custom V1 deletion, no migration, no deploy, no X use, no merge, no main push.
