# B2 — Custom sources → shared crawl kernel

**Branch:** `experiment/scraper-overhaul-b2-custom-kernel`  
**Base:** B1 `3bea45a` (`experiment/scraper-overhaul-b1-kernel-extraction`)  
**Phase:** B2 only — custom directory adapter + routing; natives untouched; V1 retained behind emergency rollback

## Architecture

```text
custom source config
  → collectCustomSourceWithV2Routing (thin router)
  → CustomDirectoryAdapter
  → crawlDirectory (DirectoryCrawlKernel)
  → RawLeads (provenance custom_site_kernel)
  → existing pipeline / batch persistence
```

Normal production custom execution does **not** import `src/experiments/**`.

## Module map

| Path | Role |
|---|---|
| `src/crawl/adapters/custom/adapter.ts` | `CustomDirectoryAdapter` (acquire/grow/release) |
| `src/crawl/adapters/custom/collect.ts` | Kernel → `CollectorResult` |
| `src/crawl/adapters/custom/crawlPlan.ts` | Versioned crawl-plan validate/invalidate/save |
| `src/crawl/adapters/custom/extractCards.ts` | Deterministic-first + bounded AI (≤1/cycle) |
| `src/crawl/adapters/custom/origins.ts` | Origin allowlist + DoraHacks block |
| `src/crawl/adapters/custom/routing.ts` | Temporary flags |
| `src/crawl/adapters/custom/generic/*` | Moved proven DOM/acquisition/AI helpers |
| `src/experiments/scraper-v2/generic/*.ts` | Re-export shims (delete in B4) |
| `src/discovery/genericScraperV2Mode.ts` | Thin router → kernel default |

## Temporary flags (delete in B4)

| Flag | Behavior |
|---|---|
| *(default)* / `CUSTOM_CRAWL_MODE=kernel` / legacy `off`/`live` | Kernel production path |
| `CUSTOM_SOURCE_SHADOW=1` or `GENERIC_SCRAPER_V2_MODE=shadow` | Kernel leads + optional experiment shadow metrics; **writes=0** |
| `CUSTOM_SOURCE_ROLLBACK_V1=1` or `CUSTOM_CRAWL_MODE=rollback_v1` | Emergency V1; logged; soak ≤14 days or 3 controlled live runs across ≥3 days |
| invalid / missing | **Kernel** (never silent V1) |

**Deletion gate:** B4 after soak above.

`off` no longer means “weak V1 forever.”

## Crawl plans

- Schema v1; file cache under `.data/crawl-plans/` (optional, non-authoritative)
- Cache loss → fresh bounded discovery (not failure)
- Save only after usable success
- Invalidate: origin/redirect, structure drift, block/auth, consecutive failures ≥3, schema/adapter mismatch, no-growth vs prior healthy inventory
- **No DB migration**

## Extraction order

1. Structured JSON/API from page artifacts  
2. Deterministic repeated DOM units  
3. Bounded AI group selection **at most once per discovery/invalidation cycle**  
4. Honest degraded / `ai_unavailable` (no V1 fallback)

## Production experiment imports

| | Before B2 | After B2 |
|---|---|---|
| Static production imports of `src/experiments/**` for normal custom collect | `genericScraperV2Mode.ts` (+budget/types) | **0** (shadow uses dynamic import only) |
| Normal custom path | V1 or experiment V2 | Kernel adapter |
| V1 reachability | default when `off` | explicit `rollback_v1` only |

## Benchmarks (live; outside deterministic CI)

See `docs/discovery/B2_CUSTOM_KERNEL_REPORT.md` for measured results.

Locked matrix: hackathons.space, Eventornado, Taikai (unseen), one static fixture, DoraHacks blocked.

## Native regression

B2 does not refactor Devpost/Luma adapters. Probes: Devpost light ~75 (50–100), deep ≥300; Luma deep ≥100 unique.

## Out of scope

B3 native migration · V1 deletion · persistence changes · DB migrations · deploy · X · merge · main push
