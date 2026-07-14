# Phase 5.2 Crawlee Runtime Integration Audit

Date: 2026-07-14
Branch: `experiment/phase-5-2-crawlee-runtime`
Base: `67a23b1028d08bf39a71c5fa9e4ef0ff93892eda`

Scope: experiment-only Crawlee runtime adapter for Scraper V2 generic acquisition. No V1/native collectors were modified. No persistence, production integration, migrations, deployment, X source, Stagehand, hostname-specific parsers, or hostname-specific selectors were added.

## Implementation Summary

- Added experiment runtime contract `CrawlRuntime` with `ExistingCustomRuntime` and `CrawleeRuntime`.
- Crawlee runtime uses HTTP/Cheerio first, Crawlee request queue, bounded retries/concurrency, same artifact contract, and in-memory Crawlee storage with `persistStorage: false`.
- Crawlee escalates to `PlaywrightCrawler` only when existing Hackfinder static sufficiency fails.
- Existing Hackfinder extraction, DOM inference, validation, normalization, identity/date/status logic, quality classification, and formatting remain the downstream decision layer.
- Added generic guardrails for:
  - account/profile/portfolio navigation links
  - www/non-www origin variants
  - expected-minimum static sufficiency to avoid accepting tiny samples as complete
  - sponsor/facet/form/questionnaire arrays winning final selection
- Added matrix runner: `src/experiments/crawleeRuntimeComparison.ts`.

## Required Coverage Table

Native counts are from the Phase 5.1 audit where available. Phase 5.2 rows are live V2 runtime results with persistence disabled.

| Source | Metric | Native | V2 Custom | V2 Crawlee |
| --- | --- | ---: | ---: | ---: |
| Devpost | profile | bounded native | deep | deep |
| Devpost | pages traversed | 12 | 20 | 1 |
| Devpost | records observed | 108 fetched before native cap | 726 | 82 |
| Devpost | valid events | 100 | 116 | 8 |
| Devpost | estimated available | 159 API total / larger page metadata observed | 13591 | 13591 |
| Devpost | estimated recall | native bounded by maxResults | 1% | 0% |
| Devpost | precision | not re-reviewed in this phase | 100% sample estimate | 100% sample estimate |
| Devpost | duration | not rerun | 7.3s | 8.7s |
| Devpost | stop reason | native maxResults/page bound | page_cap | no_growth |
| MLH | profile | native/full | deep | deep |
| MLH | pages traversed | native season pages | 2 | 1 |
| MLH | records observed | 63 | 124 | 124 |
| MLH | valid events | 63 | 63 | 63 |
| MLH | estimated available | 63 | 63 | 63 |
| MLH | estimated recall | 100% | 100% | 100% |
| MLH | precision | not re-reviewed in this phase | 100% sample estimate; 20 sampled titles are events | 100% sample estimate; same 20 sampled titles |
| MLH | duration | not rerun | 2.6s | 3.0s |
| MLH | stop reason | source exhausted/current season | fetch_failed after page probe | no_page_param |
| Hackathon Radar `/database` | profile | custom table/native | deep | deep |
| Hackathon Radar `/database` | pages traversed | 1 | 2 | 1 |
| Hackathon Radar `/database` | records observed | 25 table rows | 16 | 16 |
| Hackathon Radar `/database` | valid events | 25 | 3 | 3 |
| Hackathon Radar `/database` | estimated available | 25 | 25 | 25 |
| Hackathon Radar `/database` | estimated recall | 100% | 12% | 12% |
| Hackathon Radar `/database` | precision | not re-reviewed in this phase | 100% sample estimate | 100% sample estimate |
| Hackathon Radar `/database` | duration | not rerun | 0.7s | 1.7s |
| Hackathon Radar `/database` | stop reason | source page exhausted | fetch_failed page probe | no_page_param |

## Runtime Comparison Findings

- Devpost: Existing custom runtime remains more suitable than Crawlee for V2 because it captures and paginates the observed public API JSON. Crawlee escalates to Playwright after the sufficiency fix, but it still does not capture the same API pagination and remains at 8 valid events.
- MLH: Both runtimes are suitable. Crawlee reaches the same 63 event set using HTTP-only acquisition from the current MLH events page.
- Hackathon Radar `/database`: Neither generic runtime is suitable versus the native/custom table collector. Both extract only 3 of 25 visible rows and are correctly classified `degraded_under_extraction`.
- Garage48: Both runtimes extract 194 valid events. The large-set sample in the trace is event-like and high precision.
- DoraHacks: Crawlee improves acquisition visibility but does not recover usable event extraction. Final classification is `degraded_under_extraction` after rejecting sponsor/form/questionnaire sets; remaining sample is Terms/Rules.
- hackathons.space: Crawlee executes one generic action transition but still extracts no valid events.
- Eventornado: Crawlee escalates to browser but extracts no valid events.

## Final Quick Matrix

Full quick matrix trace: `.local-audits/traces/phase-5-2/quick-final/crawlee-runtime-comparison.md`.

Focused traces:

- Devpost/Hackathon Radar rerun: `.local-audits/traces/phase-5-2/rerun-underextract/crawlee-runtime-comparison.md` and `.local-audits/traces/phase-5-2/rerun-radar-final/crawlee-runtime-comparison.md`
- DoraHacks final rerun: `.local-audits/traces/phase-5-2/rerun-dorahacks-final/crawlee-runtime-comparison.md`
- MLH checkpoint/resume: `.local-audits/traces/phase-5-2/checkpoint-resume/mlh-com.md`

## Checkpoint/Resume

Deep MLH Crawlee run was executed twice with the same checkpoint directory:

- first run: `checkpoint loaded no`, `checkpoint saved yes`
- second run: `checkpoint loaded yes`, `checkpoint saved yes`
- both runs: 63 valid events, 100% estimated recall, `healthy_complete`

## Held-Out Sites Added

- HackerEarth: `https://www.hackerearth.com/challenges/hackathon/`
- Open Hackathons: `https://www.openhackathons.org/s/upcoming-events`
- AngelHack: `https://angelhack.com/events/`

## Decision

Crawlee is useful as an experiment-only acquisition runtime and improves queueing, retries, browser escalation, origin safety, and checkpoint instrumentation. It does not replace native collectors.

Suitability:

- Native/V1 remains preferred for production discovery.
- MLH generic V2 is suitable with either runtime for this current page shape.
- Devpost generic V2 remains unsuitable compared with native/custom acquisition for high coverage; custom V2 is materially better than Crawlee but still reports very low recall because page metadata estimates a much larger source total.
- Hackathon Radar generic V2 remains unsuitable compared with the table/native path.
- DoraHacks, hackathons.space, and Eventornado are not solved by Crawlee alone.

Stop here for this audit.
