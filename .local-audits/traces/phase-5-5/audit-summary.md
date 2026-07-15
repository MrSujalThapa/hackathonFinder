# Phase 5.5 Acquisition, Vision, And Multi-Action Audit

Date: 2026-07-15 America/Toronto
Branch: `experiment/phase-5-5-acquisition-vision-actions`
Base: `3833c62`

Scope: experiment-only Scraper V2 acquisition observation, bounded image-capable vision requests, and validated action progression. No V1/native collectors were modified. No production discovery, persistence, queue, scoring, classification, dedupe, migrations, deployment, X source, Crawlee expansion, hostname-specific parser, hostname-specific selector, hostname-specific endpoint, or hostname-specific action logic was added.

## Implementation Summary

- Added richer generic browser acquisition diagnostics:
  - response listeners attached before navigation;
  - DOM stability samples over time;
  - nested scroll container counts;
  - network JSON response counts;
  - iframe/open-shadow-root counts;
  - loading/block-state detection;
  - action trace and identity growth per accepted/rejected action.
- Added bounded viewport screenshot and rendered DOM box capture to browser snapshots.
- Extended the LLM abstraction with image content parts and mapped them to OpenAI Responses `input_image`.
- Added strict `VisionPageDecision` validation:
  - output may only choose supplied group ids or supplied action ids;
  - output may not invent events, URLs, selectors, endpoints, actions, or DOM nodes;
  - proposals must map back to existing DOM unit sets and pass deterministic validation.
- Added action progression verification:
  - no repeated action for the same page fingerprint;
  - page fingerprint must change;
  - new stable identities must appear.
- Added Phase 5.5 tests for image-capable provider mapping, strict vision validation, invented-node/action rejection, AI/vision mutual gating, two-action progression, repeated-action rejection, and no persistence/named-site logic.

## DoraHacks Acquisition Diagnosis

Final trace: `.local-audits/traces/phase-5-5/final-primary-rerun/dorahacks-io.md`

Result: no usable event record set. The blocker is conclusively acquisition-side.

Evidence:

- Browser listeners before navigation: yes.
- Final rendered URL: `https://dorahacks.io/hackathon`.
- DOM samples: `39/316/1`, stable across waits.
- Network JSON responses: `0`.
- Nested scroll containers: `0`.
- Iframes/open shadow roots: `0/0`.
- Action trace: synthetic scroll rejected because the fingerprint did not change and no new identities appeared.
- Blocked state: `human_verification`.

DoraHacks currently renders an AWS WAF/human-verification challenge to the generic headless browser. There are no exposed event cards, record arrays, nested scroll records, or usable network JSON responses to extract without bypassing a human/security check.

## Vision Provider And Bounds

| Field | Value |
| --- | --- |
| Provider/model observed | `openai/gpt-4o-mini-2024-07-18` |
| Screenshot | one bounded viewport JPEG |
| Max image payload | 900 KB |
| Candidate groups | up to 5 existing DOM unit sets |
| Sample text | up to 10 visible snippets per group |
| Action ids | up to 10 existing safe action ids |
| Timeout | 8000 ms |
| Max output tokens | 500 |
| Temperature | 0 |
| Response mode | JSON object plus strict local validation |

## Eventornado Vision Attempt

Baseline trace: `.local-audits/traces/phase-5-5/baseline/eventornado-com.md`
Final real-vision trace: `.local-audits/traces/phase-5-5/final-primary-vision-real2/eventornado-com.md`

| Metric | Baseline | After |
| --- | ---: | ---: |
| Valid events | 0 | 0 |
| Pages | 1 | 1 |
| Actions | 0 | 0 |
| DOM unit sets | 20 | 20 |
| Estimated available | 20 | 34 |
| Estimated recall | 0% | 0% |
| Quality | failed | failed |
| AI call | yes, rejected uncertain | no |
| Vision call | no provider path | yes, rejected |
| Duration | 8.2s | 13.8s |

The original Eventornado target `https://eventornado.com/hackathons` now renders a live 404 page. Vision was exercised with a real image-capable OpenAI request, but strict validation rejected the model output because it omitted required `confidence` and invented `selectedActionIds`. No events were recovered.

The alternate live page `https://eventornado.com/events` produced 9 deterministic valid events in `.local-audits/traces/phase-5-5/baseline-eventornado-events/eventornado-com.md`, but that was not a vision recovery and remained degraded against the configured expected minimum.

## hackathons.space Multi-Action Result

Final trace: `.local-audits/traces/phase-5-5/final-primary-action-trace/hackathons-space.md`

| Metric | Value |
| --- | ---: |
| Valid events | 12 |
| Estimated available | 190 |
| Estimated recall | 6% |
| Precision | 100% prior sampled review of same 12 recovered events |
| Actions discovered | 5 |
| Actions accepted | 1 |
| Identity growth after accepted action | +6 |
| Stop reason | no_growth |
| Quality | degraded_under_extraction |

Action trace:

- `action:18 / next_page / accepted / +6`
- `synthetic:scroll / infinite_scroll / rejected / +0`

The second candidate action did not change the page fingerprint and did not add stable identities, so it was correctly rejected. Phase 5.5 did not satisfy the two-consecutive-action requirement.

## Regression Results

Persistence was disabled for every run.

| Source | Valid events | Estimated available | Estimated recall | Quality | AI/vision calls | Stop reason |
| --- | ---: | ---: | ---: | --- | --- | --- |
| Devpost | 116 | 13592 | 1% | degraded_under_extraction | none | page_cap |
| MLH current events | 63 | 63 | 100% | healthy_complete | none | fetch_failed after page probe |
| Devfolio | 20 | 20 | 100% | healthy_complete | none | no_page_param |
| Garage48 | 194 | 194 | 100% | healthy_complete | none | no_page_param |
| Eventbrite | 4 | 800 | 1% | degraded_under_extraction | none | fetch_failed |
| Hackathon Radar | 3 | 25 | 12% | degraded_under_extraction | none | fetch_failed |
| hackathons.space | 12 | 190 | 6% | degraded_under_extraction | text AI accepted, no vision | no_growth |

Regression traces:

- `.local-audits/traces/phase-5-5/regression/`
- `.local-audits/traces/phase-5-5/regression-rerun/`

Healthy deterministic direct sources made zero AI/vision calls. The adaptive benchmark still shows profile/date behavior and no persistence, but its source-total estimates make MLH appear lower recall than the direct regression trace. Direct MLH extraction remains 63/63 healthy complete.

## Adaptive Benchmark

Trace: `.local-audits/traces/phase-5-5/adaptive-benchmark/adaptive-crawl-benchmark.md`

| Run | Profile | Stop | Pages | Actions | Raw records | Valid events | In horizon | Duration |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile-light | light | target_reached | 4 | 0 | 242 | 79 | 78 | 17.4s |
| profile-standard | standard | target_reached | 15 | 1 | 572 | 154 | 119 | 47.4s |
| profile-deep | deep | sources_exhausted | 37 | 1 | 1296 | 216 | 143 | 43.5s |
| next 2 weeks | light | target_reached | 4 | 0 | 242 | 79 | 9 | 15.9s |
| next 2 months | light | sources_exhausted | 5 | 0 | 239 | 43 | 15 | 33.5s |
| next 6 months | light | target_reached | 4 | 0 | 242 | 79 | 53 | 16.2s |

## Latency Notes

- DoraHacks baseline/final: 12.8s to 8.3s; final is blocked after stable low-signal DOM samples.
- Eventornado baseline/final vision: 8.2s to 13.8s; real vision latency was 2.4s.
- hackathons.space baseline/final: 16.0s to 17.4-21.8s depending on action-trace run; text AI latency ranged from 1.2s to 5.6s in live runs.
- Deterministic direct sources did not invoke AI or vision.

## Success Gate

Result: not passed.

Passed:

- DoraHacks acquisition blocker is conclusively identified.
- Eventornado executes a real image-capable vision recovery attempt.
- Vision and text AI remain bounded, declarative, sanitized, mutually gated, and deterministically validated.
- Healthy deterministic direct regression targets do not call AI/vision.
- No native collectors, production persistence, queues, scoring, classification, dedupe, migrations, deployment, X source, main branch, or named-site logic were touched.

Not passed:

- DoraHacks did not become usable.
- Eventornado did not recover useful event records from the required `/hackathons` target.
- No failed source became usable through Phase 5.5 acquisition or vision fixes.
- hackathons.space did not complete two consecutive validated actions with stable identity growth.
- Production-grade live recovery is still not proven.

## Verification

- `npm run typecheck`: passed.
- `npm run check`: passed, with pre-existing warnings in `src/lib/perf/timing.ts` and `src/server/sheets/reconcileCandidateSheetState.test.ts`.
- `npm exec -- tsx --test src/experiments/scraper-v2/generic/phase55.test.ts src/experiments/scraper-v2/generic/phase54.test.ts`: passed, 12 tests.
- Focused Phase 1-5.5 regression suite: passed, 220 tests.
- `npm exec -- tsx --test src/discovery/pipeline.test.ts`: passed alone, 6 tests.

## Commits

- `45fdae5 feat(scraper-v2): add phase 5.5 acquisition vision actions`

## Decision

Phase 5.5 improves observability and adds a real bounded vision provider path, but it does not close the production-grade recovery gaps. Native collectors remain preferred for production, and generic V2 remains experiment-only.

Stop here for this audit.
