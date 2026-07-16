# Final discovery architecture (post-overhaul)

This is the **canonical production model**. Historical phase reports under
`docs/discovery/*_REPORT.md` are audits only.

## Production path

```text
Terminal / CLI query
  → interpret query (profile, dates, location, remote, sources)
  → discovery pipeline
       ├─ native adapters (Devpost / Luma / …)
       │     └─ DirectoryCrawlKernel when directory growth is required
       ├─ thin native collectors (finite/static directories)
       └─ custom sources
             → CustomDirectoryAdapter
             → DirectoryCrawlKernel
             → RawLead (provenance custom_site_kernel)
  → normalize / verify / classify / score / dedupe
  → BatchPersistenceStrategy (sole normal writer)
  → compact job events + cursor Terminal polling
```

## Crawl

| Concept | Canonical location |
|---|---|
| Profiles (`light` / `deep`) | `src/crawl/profiles.ts` |
| Directory growth lifecycle | `src/crawl/kernel.ts` (`DirectoryCrawlKernel`) |
| Stable scroll helper | `src/crawl/growth/collectUntilStable.ts` (re-exported from `@/lib/browser/collectUntilStable`) |
| Stop / source-state | `src/crawl/types.ts`, `src/crawl/stopReasons.ts` |
| Native adapters | `src/crawl/adapters/native*` + collectors |
| Custom adapter | `src/crawl/adapters/custom/*` |

### Listing-before-detail

Devpost and Luma acquire listing inventory before detail enrichment. Detail
budgets are profile-scoped and never expand listing caps.

### Luma

Collect cards per feed **before** classification. Track feed-theme,
content-theme, and hackathon-classified counts separately. Preserve
per-feed reserved budgets so primary feeds are not starved.

### Devpost

Full-directory API pagination (`full_directory_api`). Light ≈ 50–100 (near 75);
deep ≥ 300 (near 500). Dates come from `/details/dates` after listing.

### Custom sources

Deterministic-first extraction (structured → repeated DOM → at most one
bounded AI group selection per discovery/invalidation cycle). Crawl plans are
versioned file caches under `.data/crawl-plans/` (non-authoritative).
DoraHacks is blocked without bypass/retry.

## Persistence

Normal production always selects **batch** (`selectPersistenceStrategyFromEnv`).

- Idempotent fingerprint / evidence identity planning
- Chunked lookups and writes
- Owner fields and Sheets fields never overwritten by discovery merges
- Dry-run: zero repository writes

Legacy per-row `V1PersistenceStrategy` remains on disk only while the C4 soak
calendar/run gate is unmet. It is **not** selected by normal config.
Emergency `PERSISTENCE_ROLLBACK_V1` is documented in the ops runbook and must
never be set in production deployments.

## Terminal

- Compact progressive events (coalesced `source_progress`)
- Cursor-based event polling with idle backoff
- Dry-run skips Queue invalidation
- Real runs use targeted Queue refresh only (no Sheets sync from discovery)

## Metrics vocabulary

Prefer:

- inventory / unique listing counts
- query-relevant / queue-ready / needs-review
- feed-theme vs content-theme vs hackathon-classified (Luma)

Do not conflate directory inventory with query-relevant acceptance.

## Modes users must not select

There is **no** supported V1/V2 custom scraper mode matrix and **no**
`PERSISTENCE_STRATEGY=v1` production path. Obsolete env flags are ignored or
coerced to the single production path (see runbook).
