# B4 report — remove obsolete paths

**Branch:** `experiment/scraper-overhaul-b4-remove-obsolete-paths`  
**Base:** `c649eef`  
**Measured:** 2026-07-16  
**Gate:** **PARTIAL PASS** (V1 files retained for unmet soak)

## Baseline → after

| Metric | Before | After |
|---|---:|---:|
| Experiment `.ts` files | 54 | 2 |
| Experiment test files | 9 | 1 |
| Deterministic tests | 861 | 781 |
| Deterministic runtime | ~44s | ~42s |
| `test:scraper` | 84 (experiments) | 50 (crawl contracts) |
| Crawlee package | present | **removed** |
| Prod scraper-v2 imports | 1 dynamic (shadow) | **0** |

## Live probes

| Probe | Result |
|---|---|
| Devpost light | **75**, `full_directory_api`, 2.1s |
| Devpost deep | **500**, 11.5s |
| Luma light | **44**, 25s |
| Luma deep | **130** (≥100), 41s |
| Hakku | **79**, 9.9s |
| hackathons.space | **30** |
| Eventornado | honest partial |
| Taikai | **40** |
| DoraHacks | blocked |

## Suites

typecheck / check / test (566) / test:scraper (50) / integration (207) / deterministic (781) / build — all pass.

## Remaining obsolete

- `src/collectors/customSource.ts` V1 implementation — unreachable; delete after soak
- `batchPersistenceBenchmark` — retained for C1
- Thin re-exports: `lib/browser/collectUntilStable`, `genericScraperV2Mode` filename

## Confirmation

No C1 persistence change · no migration · no deploy · no X · no merge · no main push
