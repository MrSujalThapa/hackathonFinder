# Phase 5.6.3 Authoritative Enrichment And Deep Coverage Audit

Date: 2026-07-15 America/Toronto
Branch: `experiment/phase-5-6-3-authoritative-enrichment-and-deep-coverage`
Base: `fde867afbe76c7f083d558892a4b88840a56bc5e`

Scope completed in this audit: native collector date extraction and profile-scaled crawl budgets for Devpost and Luma. No Phase 6 production integration, deployment, X source use, database migration, persistence write, main merge, main push, or V1/native behavior outside the requested collectors was performed.

## Implementation Summary

- Added distinct normalized date fields:
  - `submissionOpenDate`
  - `judgingStartDate`
  - `judgingEndDate`
  - `displayedDateRange`
- Extended parsed date evidence with source type and retrieval timestamp.
- Preserved application and submission deadlines as separate fields.
- Preserved Devpost visible date ranges separately from semantic deadlines.
- Mapped Devpost API `submission_period_dates` to `submissionOpenDate` and `submissionDeadline`, not `applicationDeadline`.
- Added canonical Devpost `/details/dates` URL construction from confirmed challenge subdomains only.
- Added bounded Devpost `/details/dates` traversal and deterministic schedule mapping for submissions, registration, judging, winners, and event periods.
- Added profile-scaled Devpost budgets:
  - light: 100 cards / 20 pages / 18 details
  - standard: 180 cards / 35 pages / 36 details
  - deep: 500 cards / 80 pages / 80 details
  - exhaustive: 1000 cards / 150 pages / 120 details
- Added Luma rendered timeline heading extraction for `Today`, `Tomorrow`, weekday headings, `This Weekend`, and absolute month/day headings.
- Luma cards can inherit the nearest valid preceding heading and preserve timeline heading/time evidence.
- Added profile-scaled Luma budgets:
  - light: 100 events / 30 scrolls / 30 details
  - standard: 180 events / 45 scrolls / 60 details
  - deep: 350 events / 80 scrolls / 120 details
  - exhaustive: 600 events / 120 scrolls / 180 details

## Live Focused Probes

Persistence was disabled for both probes.

| Probe | Raw | Unique | Queue-ready | Needs review | Rejected | Pages/scrolls | Enrichment | Duration | Stop/Limit |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | --- |
| Devpost deep focused | 163 | 163 | 0 | 43 | 120 | 22 API pages, 163 unique cards | 80 dates pages, 0 failures | 16.1s | API no additional cards |
| Luma deep focused | 83 | 28 | 0 | 0 | 28 | 13 scrolls, 83 unique cards | shared enrichment 15 pages; collector detail budget not reached before timeout | 26.4s | tech feed no growth / timeout before AI feed |

Observed Devpost improvement:

- Deep crawl is no longer capped at 100 cards.
- API pagination reached live source exhaustion at 163 current open/upcoming cards.
- The collector opened 80 canonical official dates pages within the deep profile detail budget.
- Accepted/needs-review candidates now show `submissionDeadline` where available, while `applicationDeadline` remains unknown unless separately evidenced.

Observed Luma result:

- Deep profile budget materially exceeds light budget.
- Live Luma tech feed scrolled to 83 raw events before no-growth/timeout.
- Current relevance filters correctly rejected the sampled tech/social events rather than relaxing constraints to create accepted results.
- The required broad Luma recovery was not proven in this pass.

## What Did Not Pass

This audit did not complete all Phase 5.6.3 requirements.

- Exact-title web enrichment fallback was not implemented.
- Official overview, rules, eligibility, and registration-page traversal beyond Devpost `/details/dates` was not implemented.
- The required 50-card Devpost sample with 30 manual verifications was not completed.
- The required 50-card Luma sample with 30 manual verifications was not completed.
- The required 20-candidate exact-title web enrichment validation was not completed.
- Dynamic cross-source budget reallocation was not implemented.
- Manual scenarios A-C were not run; focused scenarios D and E were run.
- Luma detail enrichment still needs better time-budget handling: the focused live run discovered weak records but collector-owned detail enrichment did not open pages before the source timeout.

## Deterministic Coverage Added

- Luma timeline heading ownership.
- Relative Luma dates.
- Absolute Luma dates.
- Rendered-card timeline inheritance.
- Deep Luma budget scaling.
- Devpost visible range extraction.
- Canonical Devpost subdomain `/details/dates` derivation.
- Devpost labelled schedule-period mapping.
- Submission versus application deadline separation.
- Deep Devpost budget scaling beyond 100 cards.
- Metadata date evidence propagation through extraction and merge.

## Verification

- `npm.cmd exec -- tsx --test src/collectors/devpost.test.ts src/collectors/luma.test.ts`: passed, 39 tests.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run check`: passed, with pre-existing warnings in `src/lib/perf/timing.ts` and `src/server/sheets/reconcileCandidateSheetState.test.ts`.
- `npm.cmd run test:fast`: passed, 498 tests.
- `npm.cmd run test:scraper`: passed, 84 tests.
- `npm.cmd run test:integration`: passed, 194 tests.
- `npm.cmd test`: passed, 498 tests.
- `npm.cmd run test:deterministic`: passed, 778 tests.

## Decision

Phase 5.6.3 is partially implemented and does not pass the full phase gate.

Passed in this scoped patch:

- visible Luma timeline dates are extracted in deterministic coverage;
- visible Devpost ranges are extracted;
- official Devpost `/details/dates` pages are traversed;
- labelled Devpost schedule fields are mapped correctly in tests;
- application and submission deadlines remain distinct;
- deep Devpost crawling is no longer capped at 100;
- deep Luma crawling budgets materially exceed light budgets;
- strict filters were not weakened to inflate results;
- deterministic suites pass.

Not passed:

- exact-title web enrichment;
- full official-page traversal;
- required manual/live sample audits;
- dynamic source-budget reallocation;
- broad deep-search proof beyond the focused Devpost/Luma probes.

Stop here for this audit slice.
