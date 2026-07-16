# A0 — Inventory and telemetry truth (corrected)

**Status:** complete as a telemetry/measurement pass; **interpretation revised 2026-07-15**  
**Scope kept for A0 code:** measurement + compact telemetry + Terminal labels only. No kernel, no `src/crawl`.

Raw probe JSON: [`.local-audits/traces/a0/inventory-probe.json`](../../.local-audits/traces/a0/inventory-probe.json)  
Probe script: [`scripts/a0-inventory-probe.ts`](../../scripts/a0-inventory-probe.ts)

---

## Corrected interpretation (mandatory)

A0 **did not** measure the full publicly reachable Devpost hackathon directory.

| Measurement | What it actually proved | What it must **not** be called |
|---|---|---|
| **166** | Exhaustion of the current `open + upcoming` API query only | `full_devpost_inventory` |
| **18** | The A0 rendered probe failed to reproduce extended browser loading on the filtered directory URL | Proof that the live directory only has 18 cards |
| Luma feed probes | Limited routes (Toronto / AI / hackathon search / Tech) with useful per-feed raw counts | Proof of broad multi-search event inventory coverage |

**Correct label for 166:** `open_upcoming_api_subset`  
**Full-directory inventory:** unresolved after A0 — requires browser network discovery on `https://devpost.com/hackathons` (A1).

### Rejected A0 conclusions

- ~~“API inventory is complete and strong (166)” as deep coverage~~
- ~~“API pagination is the authoritative listing path for deep directory recall”~~
- ~~“Rendered scroll recovers only 11% of the directory”~~ (it recovered 11% of the **subset API**, and the rendered probe itself was incomplete)

### Why the prior probes misled

1. **API path stopped at 166** because it requested only `status[]=upcoming&status[]=open` and exhausted that filtered endpoint (`meta.total_count` / `no_next_page`). That is subset exhaustion, not directory exhaustion.
2. **Rendered probe stopped at 18** because it scrolled the **already status-filtered** listing URL (`buildDevpostListingsUrl` → open+upcoming), used a low effective growth surface, and never instrumented the unfiltered directory’s real load-more network traffic. Final URL even redirected toward `page=2` with the same status filters — not the human-visible unfiltered directory crawl.
3. **Luma probes** measured four fixed feeds and did not demonstrate multi-query search coverage or collect-before-classify semantics at product scale.

### Telemetry semantics (A0 → A1 fix)

A0 telemetry that showed `observedInventory: 166 (api_total/strong)` without `acquisitionScope=open_upcoming_api_subset` was **misleading**. Later work must always attach scope.

---

## Plan corrections applied (pre-A0)

Recorded in [`SCRAPER_ENGINE_OVERHAUL.md`](./SCRAPER_ENGINE_OVERHAUL.md) (items 1–10 unchanged).

---

## Original A0 measurements (historical, scoped correctly)

### Devpost `open_upcoming_api_subset`

| Metric | Value | Scope |
|---|---|---|
| `meta.total_count` | 166 | open+upcoming API only |
| Collected unique | 166 | same |
| Status mix | open 62, upcoming 104 | API `open_state` |
| Stop | `no_next_page` | subset exhausted |

### A0 rendered probe (filtered URL — incomplete)

| Metric | Value | Note |
|---|---|---|
| Unique tiles | 18 | Not full directory |
| Filter on URL | upcoming, open | Not unfiltered `/hackathons` |
| Stop | `no_additional_cards` after 4 scrolls | Probe failure / wrong surface |

### Overlap (subset API ∩ incomplete rendered)

| Set | Count |
|---|---|
| API unique | 166 |
| Rendered unique | 18 |
| Intersection | 18 |

### Luma limited-route probes (historical)

See prior tables in git history / probe JSON. Useful as route samples only; not broad inventory proof.

### Telemetry payload size (still valid)

| Shape | Bytes |
|---|---:|
| Legacy warnings dump | 6395 |
| Compact summary rows | 763 |
| Reduction | 88.1% |

---

## Follow-on (not A0)

Full-directory Devpost recall and Luma collect-before-classify are **A1/A2** work. See [`FULL_DIRECTORY_RECALL.md`](./FULL_DIRECTORY_RECALL.md) once written.

**Do not** treat 166 as acceptable deep Devpost coverage.  
**Do not** begin B1 until hundreds-scale directory collection is demonstrated or genuinely exhausted with network evidence.
