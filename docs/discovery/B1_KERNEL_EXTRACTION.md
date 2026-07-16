# B1 crawl migration map

**Branch:** `experiment/scraper-overhaul-b1-kernel-extraction`  
**Base:** A1/A2 telemetry-correction commit (`feat(discovery): complete A1/A2…`)  
**Phase:** B1 only — extract shared kernel, no routing/persistence/B2 changes

## Module map (`src/crawl`)

| File | Role |
|---|---|
| `types.ts` | Crawl contracts (budget, adapter, stop reasons, listing cards) |
| `budget.ts` | Remaining/exhaustion/unique-cap helpers |
| `identityAccumulator.ts` | Stable identity merge + duplicate accounting |
| `stopReasons.ts` | Canonical stop ↔ source-state + legacy scroll mapping |
| `progress.ts` | Bounded compact progress events |
| `kernel.ts` | `crawlDirectory` lifecycle loop |
| `growth/collectUntilStable.ts` | Proven scroll growth loop (moved) |
| `index.ts` | Public exports |
| `kernel.test.ts` | Contract + parity tests |

## Old → new

| Old module | New module | Moved or wrapped | Current callers | Intended deletion |
|---|---|---|---|---|
| `src/lib/browser/collectUntilStable.ts` | `src/crawl/growth/collectUntilStable.ts` | **Moved**; lib file is re-export wrapper | Luma, Devpost (rendered), Hakku, lib tests | B4: delete wrapper after callers use `@/crawl` only |
| (inline stop strings in collectors) | `src/crawl/stopReasons.ts` | **Wrapped** mapping helpers; collectors keep legacy scroll strings (`max_items`, …) for Terminal parity | Kernel + tests | B4: migrate Terminal labels if desired |
| (none — new) | `src/crawl/kernel.ts` | **New** shared lifecycle | Kernel tests; ready for B2 adapters | — |
| Experiment adaptive crawler / checkpoints | unchanged | **Not migrated** | experiments + `genericScraperV2Mode` | B2–B4 |

## Import graph

### Production → `src/experiments/**` (must not increase)

Before B1 (and after): **2** production files under `src/discovery`:

- `src/discovery/genericScraperV2Mode.ts`
- `src/discovery/genericScraperV2Mode.test.ts`

B1 adds **0** new production imports from experiments.

### Production → `src/crawl`

- `src/collectors/luma.ts`
- `src/collectors/devpost.ts`
- `src/collectors/hakku.ts`
- `src/lib/browser/collectUntilStable.ts` (re-export)

## Behavior intentionally unchanged

- Devpost/Luma/Hakku collector entry points and profile budgets
- Feed order, detail budgets, query filtering
- Custom-source V2 off/shadow/live routing (`genericScraperV2Mode`)
- Persistence / Supabase
- Terminal stop-reason **strings** from scroll helpers (`max_items`, `no_growth`, …)
- No B2 custom-source kernel routing

## Remaining experiment dependencies

- `genericScraperV2Mode` still imports experiment budget/types for custom sources
- Adaptive crawler, checkpoints, vision, Crawlee comparisons remain under `src/experiments` (B2+)
