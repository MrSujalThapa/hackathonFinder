# C3 Report — Test cleanup

**Branch:** `experiment/scraper-overhaul-c3-test-cleanup`  
**Base:** `e32ec11` (`experiment/scraper-overhaul-c2-pipeline-performance`)  
**Date:** 2026-07-16

## 1. Branch / base

| Item | Value |
|---|---|
| Branch | `experiment/scraper-overhaul-c3-test-cleanup` |
| Exact base | `e32ec11617df17313d95a0b8bccd60ca2c782f75` |
| Remote C2 HEAD | matched before branch create |

## 2. Test inventory before / after

### Counts (node:test `# tests`)

| Suite | Before (C2) | After (C3) | Notes |
|---|---:|---:|---|
| `test:scraper` | 50 | 172 | Scope widened to include `src/collectors/**` |
| `test:integration` | 232 | 226 | Benchmark guards moved out; 2 terminal dupes dropped |
| `test` / `test:fast` | 566 | 564 | −2 duplicate terminal assertions |
| `test:deterministic` | 800 | 792 | −2 terminal + −6 benchmark (now outside `src/**`) |
| `test:persistence-benchmark-guards` | n/a (inside deterministic) | 6 | Explicit non-default script |

### Tracked `*.test.ts(x)` files

| | Count |
|---|---:|
| Before (HEAD) | 123 |
| After | 123 (renames + move; no net file delete of unit tests) |

### Historical audit snapshots

| | Before | After |
|---|---:|---:|
| Tracked `.local-audits/traces/phase-5*` | 78 files | 0 (deleted + `.local-audits/` gitignored) |

## 3. Files removed, retained, renamed

### Removed (from git)

- All tracked `.local-audits/traces/phase-5*` / `phase-5-*` Crawlee/vision/adaptive/checkpoint audit markdown (78 files).

### Renamed (production-concept names)

| Before | After |
|---|---|
| `src/lib/terminal/phase6Integration.test.ts` | `src/lib/terminal/terminalContracts.test.ts` |
| `src/discovery/genericScraperV2Mode.test.ts` | `src/discovery/customSourceRouting.test.ts` |
| `src/discovery/persistence/batchOnly.c1.test.ts` | `src/discovery/persistence/batchPersistence.contracts.test.ts` |
| `src/crawl/adapters/custom/routing.parity.test.ts` | `src/crawl/adapters/custom/customRouting.contracts.test.ts` |
| `src/crawl/adapters/native.parity.test.ts` | `src/crawl/adapters/nativeAdapters.contracts.test.ts` |
| `src/discovery/persistence/batchPersistenceBenchmark.test.ts` | `scripts/persistence/batchPersistenceBenchmark.test.ts` |

### Retained (still current contracts)

- Kernel, custom adapter, collector, batch persistence, pipeline, Terminal format/polling, and optional `persistenceShadow` helpers still used by production code.

## 4. Deleted groups → replacement contracts

| Deleted / reduced group | Obsolete behavior | Replacement | Remaining risk |
|---|---|---|---|
| `.local-audits` phase-5* dumps | Prove completed Crawlee/vision/adaptive experiments | Live: `b2`/`b3` probes; unit: kernel + custom adapter contracts | None for CI; live probes remain manual |
| Terminal queue-summary + fingerprint suppress in phase6 file | Duplicate of `formatEvent.test.ts` | `formatEvent.test.ts` | Low |
| Live DoraHacks crawl in mode test | Network in deterministic suite | `isBlockedCustomSourceUrl` + `customRouting.contracts.test.ts` early block | Low — live block still in B2 probe |
| Benchmark plan-safety tests in `src/**` | Audit-tool guards bloating default suite | `npm run test:persistence-benchmark-guards` | Low — still runnable |

## 5. Fixture footprint

| Location | Before | After |
|---|---|---|
| `src/collectors/__fixtures__/` | 10 files ≈ 0.03 MB | unchanged (already minimal) |
| Tracked `.local-audits/` | 78 phase-5* files | **0** (+ gitignore) |

No live browser traces committed.

## 6. Package scripts before / after

| Script | Before | After |
|---|---|---|
| `test` / `test:fast` | unchanged globs | unchanged |
| `test:scraper` | `src/crawl/**` only | `src/crawl/**` + `src/collectors/**` |
| `test:integration` | unchanged | unchanged |
| `test:deterministic` | `src/**` | unchanged (benchmark moved out of path) |
| `test:persistence-benchmark-guards` | absent | scripts persistence guards |
| `test:live:sources` | print probe help | print probe help + c2 probe + no-live-in-npm-test |

## 7. Deterministic / live separation

- Deterministic: `test`, `test:scraper`, `test:integration`, `test:deterministic` — no live inventory/calendar/network required.
- Live: `scripts/b3-native-kernel-probe.ts`, `scripts/b2-custom-kernel-benchmark.ts`, `scripts/c2-pipeline-performance-probe.ts`, dry-run `npm run agent`.
- Relative Luma dates use injected `now` in `luma.test.ts`.

## 8. Flake diagnoses / fixes

| Area | Status |
|---|---|
| Luma relative dates | Already fixed-clock (`Date.UTC(2026, 6, 15)`) |
| Progress coalescing | Covered by `c2Performance.contracts` / performance tests; no timeout inflation |
| Custom DoraHacks | Deterministic URL classify; no browser timing |
| Terminal dupes | Removed; canonical coverage in `formatEvent.test.ts` |

## 9. Focused repeated runs

Coalescer / events / luma-related scraper pass: **5/5** consecutive green during C3 (33/33 subset earlier; full `test:scraper` 172/172 on re-check).

## 10–11. Counts and runtimes

| Suite | Before tests / ~ms | After tests / ~ms |
|---|---|---|
| `test:scraper` | 50 / ~2000 | 172 / ~2700 (scope clear, includes collectors) |
| `test:integration` | 232 / ~8200 | 226 / ~7800 |
| `test:fast` | 566 / ~10700 | 564 / ~11300 |
| `test:deterministic` | 800 / ~17600 | 792 / ~19200 |

Deterministic wall time stayed roughly flat; obsolete audit weight and duplicate Terminal/live DoraHacks coverage were removed. Scraper suite is slower in absolute ms because it correctly owns collector contracts now.

## 12. Runtime regression probes

| Probe | Result | Gate |
|---|---|---|
| Devpost light | 75 | 50–100 near 75 ✓ |
| Devpost deep | 500 | ≥300 near 500 ✓ |
| Luma deep | 114 | ≥100 ✓ |
| hackathons.space | 30 | ~30 ✓ |
| Taikai | 40 | ~40 ✓ |
| DoraHacks | `blocked_human_verification`, 0 leads | blocked ✓ |
| Dry-run | `strategy=batch`, `created=0`, `db_calls=0`, `DRY RUN - NO DATABASE CHANGES` | ✓ |
| Persistence selection | `selectPersistenceStrategyFromEnv({})` → `batch` | ✓ |

No runtime source/threshold changes observed.

## 13. Production-contract coverage retained

Kernel stop reasons, Devpost/Luma/custom adapter contracts, batch persistence A–E / ownership / chunking, Terminal flag/profile/query/deadline contracts, C2 coalescing / cursor polling — all retained via renamed or existing suites. See `TEST_CONTRACTS.md` and section 3 map above.

## 14. Remaining historical-named tests

| File | Why retained |
|---|---|
| `persistenceShadow.test.ts` | Still imported by production pipeline helpers (`acceptedCandidatesToWriteSet`, optional shadow finalize) |
| Docs/history under `docs/discovery/*` phase reports | Documentation only, not executed |

No `phase5*.test.ts` remains in the tracked tree (removed in earlier B4 runtime cleanup).

## 15. Suites / build

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run check` | pass (includes build) |
| `npm test` | pass (564) |
| `npm run test:scraper` | pass (172) |
| `npm run test:integration` | pass (226) |
| `npm run test:deterministic` | pass (792) |
| `npm run test:persistence-benchmark-guards` | pass (6) |
| `npm run build` | pass (via check) |

## 16. C3 gate

**PASS**

- Phase audit snapshots removed from git + gitignored
- Production contracts retained / renamed for clarity
- Deterministic DoraHacks no longer network-dependent
- Package scripts match current architecture
- Runtime probes unchanged vs C2 thresholds
- No C4, no V1 deletion, no migration, no deploy, no X, no merge, no main push

## 17. Commits

| SHA | Message |
|---|---|
| `acd6ddc` | test(crawl): consolidate kernel and adapter contracts |
| `d6b83ce` | test(discovery): remove obsolete phase snapshots |
| `d9c6696` | test(persistence): consolidate batch idempotency coverage |
| `c6e524b` | test(terminal): consolidate progressive polling contracts |
| `d82be29` | chore(test): remove dead fixtures and scripts |
| `c33cc68` | docs(test): document production contract suites |

Pushed only to `origin/experiment/scraper-overhaul-c3-test-cleanup`.

## 18. Confirmations

- No C4 rollback deletion
- No runtime feature change (test/docs/scripts/gitignore only)
- No migration / deploy / X / merge / main push
- Both retained V1 implementations untouched
