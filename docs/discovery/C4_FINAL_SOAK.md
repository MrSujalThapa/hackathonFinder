# C4 — Final soak (scraper overhaul)

**Status:** see `C4_FINAL_SOAK_REPORT.md`  
**Branch:** `experiment/scraper-overhaul-c4-final-soak`

C4 verifies production soak and deletes legacy rollback implementations **only**
when calendar/run gates are satisfied. Architecture and ops docs:

- `FINAL_ARCHITECTURE.md`
- `OPERATIONS_RUNBOOK.md`

## Deferred file deletion (as of 2026-07-16)

| Legacy | Reachability | Delete when |
|---|---|---|
| Custom V1 body in `src/collectors/customSource.ts` | Unreachable (kernel always since B4) | 2026-07-30 **or** 3 controlled custom live days after B2 |
| `V1PersistenceStrategy` + `PERSISTENCE_ROLLBACK_V1` | Emergency-only; never normal prod | 2026-07-30 **or** ≥3 controlled batch days after C1 + A–E green |

Do not merge-delete these files early. Prefer
`MERGE_READY_WITH_DEFERRED_FILE_DELETION` until gates pass.
