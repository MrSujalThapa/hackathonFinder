# C1 — Batch-only production persistence

**Branch:** `experiment/scraper-overhaul-c1-batch-only-persistence`  
**Base:** B4 `138c2a2`  
**Status:** see `C1_BATCH_ONLY_PERSISTENCE_REPORT.md`

## Production path

```text
normalized candidates / evidence
  → selectPersistenceStrategyFromEnv() → batch (always in normal prod)
  → BatchPersistenceStrategy
  → planPersistence (identity normalize + within-batch dedupe)
  → chunked fingerprint / evidence lookups
  → chunked candidate create/update
  → chunked evidence create/update
  → chunked action inserts
  → compact persistence summary
```

## Routing rules

| Config | Result |
|---|---|
| unset / `PERSISTENCE_STRATEGY=batch` | batch |
| `PERSISTENCE_STRATEGY=v1` | **batch** + deprecation warning |
| invalid value | **batch** + deprecation warning |
| `PERSISTENCE_ROLLBACK_V1=1` | v1 emergency only (logged; dev/test) |

## Field ownership

`mergeCandidateRows` never writes:

- `status`, `approved_at`, `rejected_at`, `saved_at`
- `sheet_row_id`, `sheet_appended_at`

Source fields coalesce/merge; `last_verified` may refresh on updates.

## Evidence identity

Dedupe key: `candidate_id + type + url_key` (URL normalized via `normalizeEvidenceUrlKey`).

Distinct URLs/types are retained. Identical observations increment `seen_count` / `last_seen_at`.

## Atomicity boundary

Supabase REST has no single multi-table transaction across all chunked writes.

Order: candidate writes → evidence writes → action writes.

Partial failure returns structured errors + `writeProgress`; retries are idempotent via fingerprint / evidence identity.

## Legacy V1 soak / deletion (persistence)

`V1PersistenceStrategy` remains in `strategies.ts` but is **unreachable** from normal production selection.

Deletion requires C4 approval after:

- idempotency cases A–E
- controlled integration
- no owner/Sheets regressions
- multiple production-equivalent batch runs
- no severity-1 persistence failure

Distinct from custom-source V1 collector soak (`src/collectors/customSource.ts`).

## Audit tooling

`npm run experiment:batch-persistence` → `scripts/persistence/batchPersistenceBenchmark.ts` (not production).
