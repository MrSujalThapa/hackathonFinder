# Phase 5.4 Bounded AI And Vision-Assisted Live Recovery Audit

Date: 2026-07-14 America/Toronto
Branch: `experiment/phase-5-4-ai-vision-live-recovery`
Base: `100a5c1`

Scope: experiment-only Scraper V2 bounded AI page-decision recovery and visual proposal validation. No V1/native collectors were modified. No production discovery, persistence, queue, scoring, classification, dedupe, migrations, deployment, X source, Stagehand, Crawlee expansion, hostname-specific parser, hostname-specific selector, hostname-specific endpoint, or hostname-specific action logic was added.

## Implementation Summary

- Added strict bounded AI page decision helper for unresolved generic DOM/record groups.
- AI is invoked at most once per extraction run, only after deterministic extraction finds zero valid events and plausible unresolved groups exist.
- AI receives sanitized context only: origin, up to 5 candidate groups, up to 10 sample rows per group, and existing safe action candidates.
- AI output is declarative only: selected existing group id, classification, optional field mapping, optional existing action id, confidence, and short reasoning.
- AI proposals are rejected when they invent selectors, endpoints, URLs, executable instructions, unknown ids, extra fields, invalid enum values, or confidence below the local threshold.
- Accepted AI proposals still pass deterministic DOM extraction, schema validation, identity/date/status validation, and quality classification.
- Added generic visual grouping proposal validation that maps proposed visual groups back to existing DOM repeated-unit ids. The current LLM abstraction has no image-capable provider call path, so this audit records when vision would be appropriate and does not fake a vision result.
- Added Phase 5.4 focused tests for strict AI schema rejection, sanitized bounds, AI-selected DOM recovery, deterministic no-AI behavior, visual proposal mapping, and persistence-free generic scans.

## AI And Vision Configuration Observed

| Field | Value |
| --- | --- |
| Provider/model | `openai/gpt-4o-mini-2024-07-18` |
| Response mode | JSON object plus strict local Zod validation |
| Timeout | 8000 ms |
| Max output tokens | 500 |
| Temperature | 0 |
| Vision provider | not configured in current LLM abstraction |

## Primary Live Recovery Results

Persistence was disabled for every run.

| Site | Before valid events | After valid events | AI calls | AI accepted | Vision calls | Pages | Actions | Estimated available | Estimated recall | Precision | Quality | Stop reason |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| DoraHacks | 0 | 0 | 0 | no | 0 | 1 | 0 | unknown | 0% | 0% | failed | unknown |
| hackathons.space | 0 | 12 | 1 | yes | 0 | 1 | 1 | 20 | 60% | 100% sample | usable_partial | no_growth |
| Eventornado | 0 | 0 | 1 | no | 0 | 1 | 0 | unknown | 0% | 0% | failed | unknown |

Trace files:

- Baseline: `.local-audits/traces/phase-5-4/baseline/`
- Final primary: `.local-audits/traces/phase-5-4/final-primary/`

## Recovered Case: hackathons.space

- Baseline loss stage: DOM unit detection found 12 repeated units, but schema/identity mapping did not emit valid events.
- AI selected group: `html:0:63:1`.
- AI classification: `event_records`.
- AI latency: 1.3 s.
- Deterministic rerun after AI selection emitted 12 valid events.
- DOM schema used real page units and composite identity fallback; no canonical per-event URLs were present.
- Manual precision review inspected all 12 recovered titles and found 12 event-like results, for 100% sampled precision.
- The source is not complete: estimated available is 20, estimated recall is 60%, and quality is correctly `usable_partial`.

Recovered title sample:

- SuRaksha Cyber Hackathon 2.0
- APAC Stellar Hackathon
- UiPath AgentHack
- Splunk Agentic Ops Hackathon
- Slack Agent Builder Challenge
- Global AI Hackathon Series with Qwen Cloud
- Casper Agentic Buildathon 2026 - Qualification Round
- Build with AI: Code for Communities
- World Cup Hackathon
- Stellar Build Station Delhi NCR (21 Days Builders Sprint)
- OpenAI Build Week
- Spark Hackathon

## Remaining Zero-Result Sites

### DoraHacks

- Final trace: `.local-audits/traces/phase-5-4/final-primary/dorahacks-io.md`
- Acquisition reached browser mode but produced 0 DOM unit sets and 0 structured record sets.
- One safe action was discovered, but no action was executed by the existing generic gate.
- AI was not invoked because there were no plausible candidate groups to judge.
- Exact remaining loss stage: acquisition/page understanding does not expose a deterministic event record set or accepted DOM unit set within current generic bounds.

### Eventornado

- Final trace: `.local-audits/traces/phase-5-4/final-primary/eventornado-com.md`
- DOM inference found 20 repeated unit sets, but selected units were too weak to normalize into events.
- AI was invoked once and rejected: classification `uncertain`, selected group `dom_snapshot:0:46:3`.
- AI latency: 1.4 s.
- Vision was reported as not invoked because an image-capable provider is not configured in the current LLM abstraction.
- Exact remaining loss stage: repeated visual/DOM groups are visible, but generic schema mapping and event identity remain insufficient.

## Live Action Proof

The two-consecutive-action requirement was not met.

| Site | Actions discovered | Actions executed | Valid events | Notes |
| --- | ---: | ---: | ---: | --- |
| hackathons.space | 5 | 1 | 12 | One generic action executed, identities after action: 6. No second accepted growth action. |
| Eventbrite | 20 | 0 | 4 | Deterministic output existed; AI not invoked. |
| Taikai | 0 | 0 | 2 | No usable action path. |
| Unstop | 1 | 0 | 18 | Action discovered but not accepted/executed. |

## Regression Targets

Direct regression traces: `.local-audits/traces/phase-5-4/regression/`

| Source | Valid events | Estimated available | Estimated recall | Quality | AI invoked | Stop reason |
| --- | ---: | ---: | ---: | --- | --- | --- |
| Devpost | 116 | 13592 | 1% | degraded_under_extraction | no | page_cap |
| MLH | 63 | 63 | 100% | healthy_complete | no | fetch_failed |
| Garage48 | 194 | 194 | 100% | healthy_complete | no | no_page_param |
| Devfolio | 20 | 20 | 100% | healthy_complete | no | no_page_param |
| Eventbrite | 4 | 106 | 4% | degraded_under_extraction | no | fetch_failed |
| Hackathon Radar | 3 | 25 | 12% | degraded_under_extraction | no | fetch_failed |

No regression target needed AI because deterministic extraction already emitted valid events, so Phase 5.4 did not route them through AI recovery.

## Adaptive Benchmark

Trace: `.local-audits/traces/phase-5-4/adaptive-benchmark/adaptive-crawl-benchmark.md`

Runtime: custom V2 only. Persistence: disabled.

| Run | Profile | Sources | Stop | Pages | Actions | Raw records | Valid events | In horizon | Target coverage | Duration |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| profile-light | light | 6 | target_reached | 4 | 0 | 242 | 79 | 78 | 158% | 15.3s |
| profile-standard | standard | 6 | target_reached | 15 | 1 | 572 | 154 | 119 | 103% | 30.3s |
| profile-deep | deep | 6 | sources_exhausted | 37 | 1 | 1296 | 216 | 143 | 43% | 28.1s |
| next 2 weeks | light | 6 | target_reached | 4 | 0 | 242 | 79 | 9 | 158% | 16.2s |
| next 2 months | light | 6 | target_reached | 4 | 0 | 242 | 79 | 24 | 158% | 16.1s |
| next 6 months | light | 6 | target_reached | 4 | 0 | 242 | 79 | 51 | 158% | 18.2s |

The profile runs show depth changes. The date runs show horizon filtering changes. The benchmark did not prove general live-site recovery because only one action was accepted and DoraHacks/Eventornado remained at zero valid events.

## Product Requirement Status

Result: partially met, not fully met.

Passed:

- One previously zero-result live target, hackathons.space, recovered to usable output.
- The recovered output has all 12 results manually reviewed as event-like.
- AI remained bounded, declarative, sanitized, and behind deterministic validation.
- Misleading complete quality was avoided in the direct final trace: hackathons.space is `usable_partial`, not complete.
- Devpost, MLH, Garage48, Devfolio, Eventbrite, and Hackathon Radar did not regress in the focused regression traces.
- No native/V1 collectors changed.
- No persistence or production integration was added.

Not passed:

- DoraHacks still returns 0 valid events.
- Eventornado still returns 0 valid events.
- No live site produced two consecutive generic actions with stable identity growth.
- Actual vision-model recovery was not executed because the current provider abstraction does not expose an image-capable call path.
- Phase 5.4 therefore does not satisfy production-grade live recovery.

## Verification

- `npm run typecheck`: passed.
- `npm run check`: passed, with pre-existing warnings in `src/lib/perf/timing.ts` and `src/server/sheets/reconcileCandidateSheetState.test.ts`.
- `npm exec -- tsx --test src/experiments/scraper-v2/generic/phase54.test.ts`: passed, 6 tests.
- Focused Phase 1-5.4 suite excluding the known aggregate-timeout invocation: passed, 214 tests.
- `npm exec -- tsx --test src/discovery/pipeline.test.ts`: passed alone, 6 tests.
- The larger focused suite including `src/discovery/pipeline.test.ts` timed out once in the existing subtest `lets a fast collector path exit promptly without waiting for the total budget` when run as part of the large aggregate command; the same test file passed by itself.

## Commits

- `9aa8a91 feat(scraper-v2): add bounded AI page decisions`
- `455fd6b fix(scraper-v2): use strict local validation for AI page decisions`
- `eb3e8c2 fix(scraper-v2): harden AI page decision contract prompt`
- `2438566 feat(scraper-v2): add visual grouping proposal validation`
- `789e55f chore(scraper-v2): clean AI decision helper lint`

## Decision

Phase 5.4 proves a useful bounded AI recovery path for one real generic V2 failure mode: selecting an existing DOM repeated-unit group that deterministic schema mapping failed to accept. It does not prove generalized live-site recovery. Native collectors remain preferred for production, and V2 remains experiment-only.

Stop here for this audit.
