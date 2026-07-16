# B3 — Native growth → shared DirectoryCrawlKernel

**Branch:** `experiment/scraper-overhaul-b3-native-kernel`  
**Base:** B2 `578e332` (`experiment/scraper-overhaul-b2-custom-kernel`)  
**Phase:** B3 only — native listing growth on shared kernel; parsers/enrichment stay source-owned

## Architecture

```text
Devpost collector
  → collectDevpostViaKernel
  → DevpostDirectoryAdapter.grow (API page batches)
  → crawlDirectory
  → listing stop
  → enrichDevpostSchedules (/details/dates)   # A1 unchanged

Luma collector / feed controller
  → per-feed collectLumaFeedViaKernel
  → LumaFeedAdapter.grow (scroll only)
  → crawlDirectory
  → global merge / theme / classification     # A2 unchanged; outside kernel

Hakku collector
  → collectUntilStable (@/crawl)              # shared growth primitive
  → Hakku auth/session/detail limits retained
```

## Module map

| Path | Role |
|---|---|
| `src/crawl/adapters/devpost/*` | Devpost API directory adapter + kernel collect wrapper |
| `src/crawl/adapters/luma/*` | Per-feed scroll adapter + kernel collect wrapper |
| `src/crawl/adapters/native.parity.test.ts` | Stop-reason / target / cap / progress parity |
| `src/collectors/devpost.ts` | Parsers, dates enrichment, product budgets (unchanged semantics) |
| `src/collectors/luma.ts` | Feeds, themes, classification, detail selection |
| `src/collectors/hakku.ts` | Auth wall + `collectUntilStable` |

## Native migration table

| source | current mechanism | B3 action | shared primitive | source-specific logic retained | reason |
|---|---|---|---|---|---|
| Devpost | concurrent API page loop | full kernel adapter | `crawlDirectory` | API URL/parse, open_state, dates enrichment | growth + caps belong in kernel |
| Luma | per-feed `collectUntilStable` | per-feed kernel adapter | `crawlDirectory` | feed order, themes, classification, Tech fallback | one feed session at a time |
| Hakku | `collectUntilStable` | shared primitive only | `collectUntilStable` | auth wall, public listing, detail limits | full browser adapter would risk behavior change |
| MLH | finite season HTML/Inertia | no migration | — | season parse | no growth loop |
| HackList | single SSR page | no migration | — | card parse | finite static |
| Web search | search API thin collector | no migration | — | query construction | not a directory crawl |
| Custom | B2 kernel adapter | untouched | `crawlDirectory` | generic DOM/AI | B2 complete |
| X | disabled / out of scope | skip | — | — | do not use X |

## Kernel boundary (unchanged)

Kernel may own: lifecycle, growth, budget, identity, stop reasons, compact progress, inventory telemetry.

Kernel must not own: Devpost/Luma hostnames, themes, hackathon classification, API schemas, detail enrichment, persistence.

## Stop-reason parity

| Canonical | Meaning |
|---|---|
| `exhausted` | source ended (e.g. no next API page) |
| `no_growth` | repeated growth added no identities |
| `target_reached` | profile soft target hit |
| `maximum_cards_reached` | hard card cap |
| `max_budget` | request/page/action budget |
| `timeout` / `cancelled` | deadline / abort |

Devpost maps kernel stops back to existing telemetry strings (`no_next_page`, `api_page_failed`, …) without renaming Terminal states.

## Luma timeline flake

**Cause:** `parseLumaHtml` filtered with `isUpcoming(..., now = new Date())` and ignored the injected fixture `now`. Relative headings like `Tomorrow` resolved against the fixture date, then were dropped when wall-clock passed that day.

**Fix:** pass fixture `now` into `isUpcoming`. Not a flake of ordering/async — deterministic clock coupling.

## Import graph

| | Before B3 | After B3 |
|---|---|---|
| Native growth | Devpost custom loop; Luma/Hakku `collectUntilStable` | Devpost/Luma → `@/crawl` kernel adapters; Hakku → `collectUntilStable` |
| Production `src/experiments/**` | shadow/shim only (B2) | **unchanged count** — no new production experiment imports |
| Custom normal path | experiment-free | untouched |

## Out of scope

B4 deletion · persistence · DB migrations · deploy · X · merge · main push
