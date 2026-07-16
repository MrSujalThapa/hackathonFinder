# C4 Report — Final soak and merge readiness

**Branch:** `experiment/scraper-overhaul-c4-final-soak`  
**Base:** `0d2a8fe` (`experiment/scraper-overhaul-c3-test-cleanup`)  
**Date:** 2026-07-16  
**Verdict:** **PARTIAL PASS** → **`MERGE_READY_WITH_DEFERRED_FILE_DELETION`**

## 1. Branch / base

| Item | Value |
|---|---|
| Branch | `experiment/scraper-overhaul-c4-final-soak` |
| Exact base | `0d2a8feabd4ff833a38eb6476b51c7b2045c0a39` |
| Ancestry | Includes B4 (`138c2a2`), C1, C2 (`e32ec11`), C3 (`0d2a8fe`) |

## 2. Custom V1 soak evidence → **GATE FAIL (calendar/run-count)**

| Field | Evidence |
|---|---|
| B2 cutover | `2026-07-16` · tip `578e332` |
| Elapsed days | **0** (same calendar day as cutover) |
| Controlled kernel custom runs | Multiple same-day (B2/B3/B4/C3/C4 probes) |
| Distinct days | **1** (need ≥3) |
| Sources covered today | space 30, Taikai 40, Eventornado 11 (partial), DoraHacks blocked, static unit, dry-run CLI |
| Severity-1 regressions | **None observed** |
| Emergency `CUSTOM_SOURCE_ROLLBACK_V1` used | **No** (flag ignored since B4; `isCustomSourceRollbackV1` always false) |

**Decision:** Do **not** delete `src/collectors/customSource.ts` V1 body. Keep unreachable.  
**Delete after:** calendar **2026-07-30** **or** 3 controlled live custom days with no severity-1 regression.

## 3. Persistence V1 soak evidence → **GATE FAIL (calendar/run-count)**

| Field | Evidence |
|---|---|
| C1 cutover | `2026-07-16` · tip `c307a2c` |
| Elapsed days | **0** |
| Controlled batch runs | Same-day C1–C4 dry-runs + MLH real writes (0 creates) + contract A–E |
| Distinct days | **1** |
| Idempotency A–E | Green (`batchPersistence.contracts.test.ts`) |
| Emergency `PERSISTENCE_ROLLBACK_V1` used | **No** (must never be set in prod) |
| Severity-1 persistence failures | **None** |

**Decision:** Do **not** delete `V1PersistenceStrategy` / `PERSISTENCE_ROLLBACK_V1`. Leave emergency-only.  
**Delete after:** **2026-07-30** **or** ≥3 controlled batch days + A–E + explicit approval.

## 4. Legacy removed in C4

None (gates unmet). Cleanup only:

- `next.config.ts` dropped obsolete Crawlee `serverExternalPackages` entries (Crawlee already uninstalled in B4)
- Soak blocker strings updated with exact dates/commits

## 5. Legacy retained + blockers

| Item | Classification | Blocker |
|---|---|---|
| `src/collectors/customSource.ts` V1 `collectCustomSource` | unreachable rollback / soak-gated | calendar/run-count |
| `CUSTOM_SOURCE_ROLLBACK_V1` key name | obsolete ignored flag | keep until file delete (deprecation warn) |
| `V1PersistenceStrategy` | emergency-only | calendar/run-count |
| `PERSISTENCE_ROLLBACK_V1` | emergency env | calendar/run-count |
| `PERSISTENCE_V1_SOAK_BLOCKER` / `CUSTOM_V1_SOAK_BLOCKER` | required docs constants | until deletion |
| `collectUntilStable` re-export | compatibility shim | keep (no duplicate impl) |
| `genericScraperV2Mode.ts` name | compatibility router → kernel | keep |
| `scripts/persistence/batchPersistenceBenchmark*` | audit-only | keep |
| `src/experiments/**` | **absent** (0 tracked files) | n/a |

## 6. Final production routing proof

```text
custom → collectCustomSourceWithV2Routing → collectCustomSourceViaKernel
      → CustomDirectoryAdapter → DirectoryCrawlKernel → RawLead → pipeline → batch

native growth → native adapter → DirectoryCrawlKernel → pipeline → batch

finite native → thin collector → pipeline → batch
```

Covered by `src/discovery/singlePath.architecture.test.ts` + existing routing/persistence contracts.

## 7. Import / configuration audit

| Check | Result |
|---|---|
| Production static `@/experiments` imports | **0** (asserted in singlePath + profiles tests) |
| Tracked `src/experiments/**` | **0** |
| `crawlee` in package.json | **0** |
| Vision/adaptive crawl runtimes | **0** (removed B4) |
| Normal persistence selection | **batch** |
| Selectable custom V1 | **no** |

## 8–9. Docs

- `docs/discovery/FINAL_ARCHITECTURE.md`
- `docs/discovery/OPERATIONS_RUNBOOK.md`
- `docs/discovery/C4_FINAL_SOAK.md`
- AGENTS.md pointers

## 10–12. Live soak matrix (C4)

| Probe | Result |
|---|---|
| Devpost light | **75** · full_directory_api · target reached |
| Devpost deep | **500** |
| Luma deep | **113** (≥100) |
| Hakku | **78** (auth OK) |
| hackathons.space | **30** |
| Taikai | **40** |
| Eventornado | **11** honest partial |
| DoraHacks | blocked, 0 leads |
| Dry-run CLI/Terminal | `strategy=batch`, `db_calls=0` |
| Controlled MLH real ×2 | batch; created=0 both runs (no matching leads; idempotent) |

## 13–14. Terminal + cancellation

| Check | Result |
|---|---|
| Authenticated Terminal light dry-run | Pass — interpretation, compact progress, `strategy=batch`, `db_calls=0`, Applications/Submissions labels, Queue stayed empty |
| Deep dry-run | CLI pass; Terminal deep briefly hit 500 after concurrent `npm run check` invalidated `.next` (dev port collision). Retried on clean `:3001` |
| Cancellation | Job `d4070365-…` → `status=cancelled`, `cancelRequested=true` via authenticated API; unit contracts for terminal transitions also green |

## 15–16. Tests / build

| Command | Result |
|---|---|
| typecheck | pass |
| test:scraper | **172** pass |
| test:integration | **231** pass (+5 single-path) |
| test / test:fast | **564** pass |
| test:deterministic | **797** pass |
| persistence-benchmark-guards | **6** pass |
| check (lint+typecheck+build) | pass |
| Flaky suite ×5 (c2/luma/kernel) | **40/40** each run |

## 17. Repository metrics (final)

| Metric | Value |
|---|---|
| Production experiment imports | 0 |
| Experiment files tracked | 0 |
| Crawlee dependency | 0 |
| Custom V1 file | retained unreachable |
| Persistence V1 class | retained emergency-only |
| Growth implementations | 1 kernel + 1 collectUntilStable |
| Persistence writers (normal) | 1 batch |
| Tracked `.local-audits` | 0 (gitignored) |

## 18. Remaining limitations

- Custom + persistence V1 **file** deletion deferred to **2026-07-30** or multi-day controlled evidence
- Emergency persistence rollback still exists for soak period (document; never enable in prod)
- Web/Tavily HTTP 432 noise in some Terminal runs (external; not scraper regression)

## 19. C4 gate

**PARTIAL PASS** — architecture/runtime merge-ready; deletion gates honestly unmet.

## 20–21. Merge recommendation

**`MERGE_READY_WITH_DEFERRED_FILE_DELETION`**

Merge **only**:

`experiment/scraper-overhaul-c4-final-soak`

Do not merge intermediate A/B/C branches separately.

Deferred follow-up (post-soak, separate PR): delete custom V1 body + persistence V1 + rollback flags after gates pass.

## 22. Commits

| SHA | Message |
|---|---|
| `a4a7821` | chore(discovery): verify final scraper soak gates |
| `66e124f` | test(discovery): verify final single-path architecture |

**HEAD:** `594574d` (includes architecture docs, ops runbook, C4 report, single-path tests, next.config cleanup)

| `594574d` | docs(discovery): pin C4 commit SHAs in soak report |

Pushed only to `origin/experiment/scraper-overhaul-c4-final-soak`.

## 23. Pre-merge validation fixes

Generic gaps closed during mandatory Terminal / custom-source validation (no Reskilll-specific collector or hostname logic):

1. DOM extraction: registration/status chrome vs event titles; registration dates → deadline fields; closed status preserved.
2. NL `from <custom source>` → exclusive custom-source selection.
3. San Francisco aliases + explicit city constraint (broad CA/US insufficient).
4. `next N months` date parsing before generic `upcoming`.

Local evidence remains under gitignored `.local-audits/c4-premerge/`.

## 24. Confirmations

No migration · no deploy · no X · no merge · no main push · no V1 deletion · no feature/threshold changes.
