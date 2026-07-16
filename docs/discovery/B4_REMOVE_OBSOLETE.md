# B4 — Remove obsolete scraper paths

**Branch:** `experiment/scraper-overhaul-b4-remove-obsolete-paths`  
**Base:** B3 `c649eef`  
**Status:** **PARTIAL PASS** — V1 *file* deletion blocked by unmet soak calendar; V1 is unreachable from production.

## Final production model

```text
custom URL
  → collectCustomSourceWithV2Routing (name retained; kernel-only)
  → CustomDirectoryAdapter
  → DirectoryCrawlKernel
  → RawLead → discovery pipeline

native source
  → native collector/adapter
  → DirectoryCrawlKernel where growth exists (Devpost/Luma)
  → collectUntilStable for Hakku listing scroll
  → discovery pipeline
```

## Removed

| Area | Action |
|---|---|
| `src/experiments/scraper-v2/**` | Deleted (shims + Crawlee/vision/adaptive/structuredExtraction) |
| Crawlee package | `npm uninstall crawlee` |
| Vision runtime | Deleted with scraper-v2 |
| Adaptive/checkpoint crawl runtime | Deleted with scraper-v2 |
| Shadow comparison | Removed from production routing |
| Rollback/shadow/GENERIC_SCRAPER_V2 flags | Ignored with deprecation warning; always kernel |
| Phase snapshot / Crawlee / vision / adaptive tests | Deleted with scraper-v2 |
| Experiment npm scripts | Removed except `experiment:batch-persistence` (C1-related) |

## Retained (intentional)

| Module | Why |
|---|---|
| `src/collectors/customSource.ts` (V1 impl) | Soak gate unmet; **unreachable** from production routing / site check |
| `src/experiments/batchPersistenceBenchmark*` | Persistence benchmark for future C1 — not a crawl runtime |
| `src/lib/browser/collectUntilStable.ts` | Thin re-export of `@/crawl` (no duplicated impl) |
| `genericScraperV2Mode.ts` filename | Pipeline import stability; body is kernel-only |
| Source-specific budget helpers in collectors | Product thresholds unchanged |

## Custom V1 soak blocker

Gate required: ≤14 days soak **or** 3 controlled live custom runs across ≥3 days after B2 cutover (`2026-07-16`).

As of B4 (`2026-07-16`): calendar soak not met; only same-day controlled runs exist (B2/B3/B4 probes).

Therefore:

- rollback flag **removed** (V1 unreachable);
- V1 **files retained** pending soak;
- B4 marked **partial** for V1 file deletion only.

## Canonical contracts

- Profiles: `src/crawl/profiles.ts` → `DiscoveryProfile`
- Stop / source-state: `src/crawl/types.ts` + `src/crawl/stopReasons.ts`
- Growth: `DirectoryCrawlKernel` + `collectUntilStable` (one implementation each)

## Import gates

Production static/dynamic imports of `src/experiments/scraper-v2` = **0**.  
Crawlee production imports = **0**.  
Vision / adaptive crawl runtime imports = **0**.

## Out of scope

C1 persistence · DB migration · deploy · X · merge · main push
