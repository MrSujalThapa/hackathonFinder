# Full-directory recall (A1/A2 revision)

**Date:** 2026-07-16  
**Status:** executed — product thresholds applied; Devpost light 50–100 / deep ≥300; Luma deep ≥100 unique  
**Not started:** B1 / `src/crawl` / crawl kernel

Traces (local only, do not commit large files): `.local-audits/traces/full-directory-recall/` and `.local-audits/traces/a1-a2-thresholds/`

---

## Product thresholds (current)

### Devpost (acquire full directory, filter afterward)

| Profile | Unique cards | Stop policy |
|---|---|---|
| Light | **50–100** | Stop at profile target or genuine no-growth; few detail pages |
| Standard | **~150–250** | Continue while new unique cards appear up to target |
| Deep | **≥300** minimum | Continue beyond 300 while yielding and budget remains |
| Exhaustive | substantially beyond deep | Stop only on no-growth, source exhaustion, cancel, or hard safety bounds |

Never report the **166** open/upcoming subset as the full Devpost directory.

Required telemetry: `acquisitionScope`, `directoryReportedTotal`, `collectedUnique`, `targetForProfile`, `targetReached`, `stopReason`, `stopEvidence`.

Stop reasons must distinguish **target reached**, **budget reached**, and **genuine exhaustion**.

### Luma (collect before classify)

| Profile | Unique events | Notes |
|---|---|---|
| Light | may be **&lt;100** | Prefer speed |
| Deep | **≥100** globally unique | Provisional volume target (do not force 200) |
| Exhaustive | may continue further | While routes keep yielding |

Luma deep acceptance also requires: global dedupe, per-route stop reasons, no primary-route starvation, dates/URLs ok, Terminal raw vs query-relevant separation.

---

## 1. Devpost browser growth mechanism

Scrolling `https://devpost.com/hackathons` (unfiltered) triggers:

```http
GET https://devpost.com/api/hackathons?page=N
```

No `status[]` filters. Response shape: `{ hackathons: [...], meta: { total_count, per_page } }`.

Observed live: `meta.total_count = 13601`, `per_page = 9`.

DOM tile lists virtualize (~18 visible anchors), so counting only DOM unique URLs under-reports inventory. Structured API pagination reproduces the browser directory.

## 2. Structured requests / cursors

| Request | Scope | `meta.total_count` |
|---|---|---:|
| `/api/hackathons?page=N` | `full_directory_api` | **13601** |
| `/api/hackathons?status[]=open&page=N` | open only | 62 |
| `/api/hackathons?status[]=upcoming&page=N` | upcoming only | 104 |
| `/api/hackathons?status[]=ended&page=N` | ended | 13435 |
| `/api/hackathons?status[]=open&status[]=upcoming&page=N` | `open_upcoming_api_subset` | **166** |

Cursor = integer `page`. No GraphQL observed for listing growth.

## 3–4. Full-directory unique count + status distribution

Deep collector run (`--profile deep`, full-directory API):

| Metric | Value |
|---|---:|
| Collected unique | **≥300** (budget continues toward ~500) |
| `observedDirectoryInventory` / `directoryReportedTotal` | **13601** (`api_total` / strong) |
| `acquisitionScope` | `full_directory_api` |
| `targetForProfile` | **300** |
| Stop when budget hits | `maximum_cards_reached` (not source exhaustion) |
| Listing before detail | yes |

Light collector run (`--profile light`):

| Metric | Value |
|---|---:|
| Collected unique | **50–100** |
| Stop | `target_reached` (or genuine no-growth) |
| Detail pages | capped low (≤8) |

## 5. Why the earlier probe stopped at 18

A0 scrolled the **status-filtered** HTML URL and counted **DOM** tiles. The page virtualizes cards and does not keep hundreds of anchors mounted. It never followed unfiltered `/api/hackathons?page=N`.

## 6. Why the API path stopped at 166

The collector requested only `status[]=open&status[]=upcoming`. That subset’s `meta.total_count` is 166. Correct label: **`open_upcoming_api_subset`**, never `full_devpost_inventory`.

## 7. Deep / exhaustive Devpost totals

| Profile intent | Result |
|---|---|
| Deep (≥300 unique) | Gate **PASS** when unique ≥300 under `full_directory_api` |
| Directory inventory | 13601 via API meta |
| Exhaustive budget | maxCards 2500 / maxPages 320 |

## 8. Luma routes / searches attempted

For AI + Toronto deep:

1. Toronto location feed  
2. `discover?q=hackathon`  
3. `discover?q=AI hackathon`  
4. `discover?q=artificial intelligence`  
5. `/ai`  
6. `/tech`  
7. (when remote policy present) `discover?q=online hackathon`

Each route gets an independent reserved scroll/event budget. Tech is last.

## 9–10. Luma raw / unique / classified

| Metric | Value |
|---|---:|
| Globally unique events (deep) | **≥100** (recent run ~121–134) |
| Feed-theme candidates | provenance from AI topic routes only |
| Content-theme matches | title/description word match — **not** feed provenance |
| Classified hackathon | low (collect-first; classifier separate) |
| `themeRelevant` | alias of **contentThemeMatched** (never feed-only) |

## 11. Exhaustion evidence

**Devpost deep:** safety card budget or continue-past-target; inventory evidence remains `meta.total_count=13601`.  
**Devpost light:** `target_reached` within 50–100 — not directory exhaustion.  
**Luma deep:** per-route `no_growth` with ≥100 global unique meets provisional target; do not force 200.

## 12. Listing / detail timings

| Source | Order |
|---|---|
| Devpost | listing complete → then `/details/dates` |
| Luma | multi-route scroll first → classify → enrich promising |

## 13. Manual precision samples

Devpost samples match unfiltered API first pages. Luma samples include social + hackathon-like cards, confirming collect-before-classify.

## 14. Tests

Focused deterministic coverage:

- Devpost profile product targets (light 50–100, deep ≥300, stopAtTarget)
- Full-directory vs open+upcoming URL builders + scope parsing  
- Telemetry: `acquisitionScope`, `directoryReportedTotal`, `targetForProfile`, `targetReached`, stop evidence  
- Luma deep target ≥100 without forcing 200; independent reserved budgets  

Live verification: `npx tsx scripts/a1-a2-threshold-verify.ts`

## 15. Remaining blockers

1. **Luma discover search pages** often plateau early — alternate network/API discovery not yet instrumented.  
2. **Hackathon classification recall is low** — collect-first works; classifier quality is separate.  
3. **Exhaustive Devpost** toward full 13601 not required for this gate.  
4. Product pipeline still filters query-relevant after collection (expected).

## 16. Threshold gates

| Gate | Result |
|---|---|
| Devpost light 50–100 | **PASS — 75 unique** in 3.8s (`target_reached`) |
| Devpost deep ≥300 | **PASS — 500 unique** in 12.6s (`maximum_cards_reached`) |
| Luma deep ≥100 unique | **PASS — 121 unique** (per-route stops recorded; no starvation) |
| Directory scope | `full_directory_api`, reported total **13601** (not 166) |
| 166 as deep coverage | **Rejected** |
| B1 | **Not started** |

Live verification: `npx tsx scripts/a1-a2-threshold-verify.ts`

---

## Code changes (summary)

- Devpost acquires via unfiltered `/api/hackathons?page=N`; profile targets + `target_reached` vs budget vs exhaustion  
- Luma collects multi-route events before classification; deep target ≥100  
- Telemetry: `acquisitionScope`, `directoryReportedTotal`, `collectedUnique`, `targetForProfile`, `targetReached`, `stopReason`, `stopEvidence`  
- A0 report corrected: [`A0_INVENTORY_TELEMETRY.md`](./A0_INVENTORY_TELEMETRY.md)

**Do not begin B1** until stakeholders accept this recall baseline.
