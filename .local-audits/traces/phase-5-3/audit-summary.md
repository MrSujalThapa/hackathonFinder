# Phase 5.3 Adaptive Page Understanding Audit

Date: 2026-07-14 America/Toronto
Branch: `experiment/phase-5-3-adaptive-page-understanding`
Base: `cb9fc36e77885a29ded678cdb2a2811b0eaad295`

Scope: experiment-only Scraper V2 adaptive page understanding and crawl execution. No V1/native collectors were modified. No production discovery, persistence, queue, scoring, classification, dedupe, migrations, deployment, X source, Stagehand, Crawlee expansion, hostname-specific parser, hostname-specific selector, hostname-specific endpoint, or hostname-specific pagination logic was added.

## Implementation Summary

- Added Phase 5.3 runtime architecture gate: `.local-audits/traces/phase-5-3/runtime-architecture.md`.
- Added adaptive crawl profiles: `light`, `standard`, `deep`, and `exhaustive`, with materially different source/page/request/action/detail/duration caps.
- Added date-aware intent planning for next 2 weeks, next 2 months, and next 6 months.
- Added adaptive source scheduling using local yield estimates, source expected counts, latency preference, coverage preference, and host bulkheads.
- Added experiment-only adaptive orchestrator with progressive batches, global identity dedupe, stop reasons, time-to-first-10/50/target, and checkpoint support for deep/exhaustive runs.
- Added generic identity fallback order: canonical URL, structured source ID, then composite title/date/location hash.
- Added page understanding observations for structured records, DOM repeated units, safe actions, accessibility nodes, iframes, declarative shadow roots, virtualized-list signals, and modal signals.
- Added bounded AI/vision gating predicates only; no new AI provider calls or vision implementation were added.
- Wired existing generic browser action helpers into the custom acquisition path when an explicit `maxBrowserActions` budget is supplied.
- Added repeatable benchmark runner: `npm run experiment:phase53-adaptive`.

## Live Adaptive Benchmark

Trace: `.local-audits/traces/phase-5-3/adaptive-benchmark/adaptive-crawl-benchmark.md`

Runtime: custom V2 only. Persistence: disabled.

| Run | Crawl Type | Profile | Sources | Stop | Pages | Actions | Raw Records | Valid Events | In Horizon | Target Coverage | Duration | Notes |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| profile-light | bounded sample | light | 6 | target_reached | 4 | 0 | 242 | 79 | 78 | 158% | 14.8s | Stopped after Devpost + MLH reached target. |
| profile-standard | bounded multi-source | standard | 6 | sources_exhausted | 15 | 1 | 572 | 142 | 107 | 95% | 28.1s | Recovery targets still failed. |
| profile-deep | bounded deep crawl | deep | 6 | sources_exhausted | 37 | 1 | 1296 | 204 | 131 | 41% | 18.5s | Higher caps improved Devpost but did not solve recovery targets. |
| next 2 weeks | date-bounded sample | light | 6 | target_reached | 4 | 0 | 242 | 79 | 9 | 158% | 13.4s | Horizon filtering reduced in-horizon count. |
| next 2 months | date-bounded sample | light | 6 | target_reached | 4 | 0 | 242 | 79 | 24 | 158% | 12.2s | Horizon filtering widened in-horizon count. |
| next 6 months | date-bounded sample | light | 6 | target_reached | 4 | 0 | 242 | 79 | 51 | 158% | 13.8s | Horizon filtering widened in-horizon count again. |

## Source Suitability

| Source | Crawl | Pages | Actions | Valid Events | Estimated Source Total | Estimated Recall | Precision | Stop Reason | Suitability |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Devpost | bounded deep V2 sample | 30 | 0 | 116 | 13591 | 1% | 100% sample estimate | page_cap | V2 remains unsuitable for full source coverage versus native/custom authoritative acquisition. |
| MLH | full current-season V2 crawl | 2 | 0 | 63 | 63 | 100% | 100% sample estimate | fetch_failed page probe after source exhausted | V2 suitable for the current MLH page shape. |
| Hackathon Radar `/database` | bounded deep V2 sample | 2 | 0 | 25 | 100 | 24% | 100% sample estimate | no_growth | Better than Phase 5.2, but still classified degraded because estimated recall is low. Native/custom table path remains preferred. |
| DoraHacks | bounded deep V2 recovery target | 1 | 0 | 0 | unknown | 0% | 0% | unknown | Not recovered. |
| hackathons.space | bounded deep V2 recovery target | 1 | 1 | 0 | 20 expected-min floor | 0% | 0% | no_growth | One generic action executed, but no normalized events. |
| Eventornado | bounded deep V2 recovery target | 1 | 0 | 0 | unknown | 0% | 0% | unknown | Not recovered. |

## Recovery Target Diagnosis

### DoraHacks

Trace: `.local-audits/traces/phase-5-3/live-primary/dorahacks-io.md`

- Acquisition reached browser mode but inspected only 2 artifacts and 20,006 bytes.
- One safe action was discovered, but zero actions executed.
- No structured arrays, no DOM repeated unit set, no selected schema, and zero normalized leads were produced.
- Exact loss stage: acquired page did not expose a deterministic event record set or accepted DOM unit set within the current generic runtime bounds.

### hackathons.space

Trace: `.local-audits/traces/phase-5-3/live-actions-final/hackathons-space.md`

- Acquisition reached browser mode and executed one generic action.
- Action diagnostics: 5 actions discovered, 1 action executed, identities after action: 6.
- DOM inference found 4 repeated unit sets and selected 12 units, but no normalized leads survived schema/normalization.
- Exact loss stage: DOM unit detection exists, but field/schema mapping and event-normalization remain insufficient; pagination/action execution alone does not recover valid events.

### Eventornado

Trace: `.local-audits/traces/phase-5-3/live-primary/eventornado-com.md`

- Acquisition reached browser mode and inspected 119,910 bytes.
- One safe action was discovered, but zero actions executed.
- DOM inference found 20 repeated unit sets and selected 2 units, but no normalized leads survived validation/normalization.
- Exact loss stage: repeated DOM groups are visible, but generic schema mapping/event identity is not strong enough to emit valid events.

## Live Interactive Action Gate

Result: not met.

- Required proof: at least one live target with two consecutive generic actions, new stable identities after each action, and no source-specific logic.
- Best live result: hackathons.space executed one generic action and recorded 6 visible identity estimates after the action.
- Eventbrite and broader live probes discovered actions, but no run produced two accepted consecutive generic actions with stable identity growth.
- This audit therefore does not claim Phase 5.3 production-grade interactive recovery success.

## Checkpoint / Resume

Fresh sequential MLH checkpoint run:

- First run trace: `.local-audits/traces/phase-5-3/checkpoint-sequential-first/mlh-com.md`
  - checkpoint loaded: no
  - checkpoint saved: yes
  - valid events: 63
  - quality: `healthy_complete`
- Second run trace: `.local-audits/traces/phase-5-3/checkpoint-sequential-second/mlh-com.md`
  - checkpoint loaded: yes
  - checkpoint saved: yes
  - valid events: 63
  - quality: `healthy_complete`

## Quality Classification

- Partial bounded samples are not labelled complete unless source exhaustion or high estimated recall is observed.
- Devpost deep remains `degraded_under_extraction` despite 116 valid events because estimated recall is about 1%.
- Hackathon Radar deep remains `degraded_under_extraction` despite 25 valid events because estimated recall is about 24%.
- MLH is `healthy_complete` because the current page exposes 63 estimated available events and V2 extracts 63.
- Recovery targets with zero valid events remain `failed`.

## Decision

Phase 5.3 is a useful experiment-only runtime step, not a production-ready replacement for native collectors.

Passed:

- Architecture gate.
- Experiment-only implementation.
- No V1/native collector changes.
- No persistence or production integration.
- Profile/date/checkpoint/progressive execution support.
- Generic opt-in browser action helper execution.
- More honest precision/coverage reporting.

Not passed:

- DoraHacks, hackathons.space, and Eventornado live-site recovery.
- Two consecutive generic browser actions with stable identity growth on a live target.
- Production-grade adaptive page understanding for arbitrary modern app pages.

Stop here for this audit.
