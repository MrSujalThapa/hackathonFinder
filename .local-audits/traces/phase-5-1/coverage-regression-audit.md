# Phase 5.1 Coverage Regression Audit

Date: 2026-07-14
Branch: `experiment/phase-5-1-coverage-regression-audit`
Base: `9d8def195b65cdbbef8d9c119caad13af1923de4`

Scope: Devpost, MLH, and Hackathon Radar native-vs-generic V2 coverage. No V1/native collectors were modified. No V2 output was persisted.

## Summary

Phase 5's live coverage evaluation was misleading because V2 results were labelled healthy without proving source exhaustion or high recall.

Fixes made:

- Generic V2 quality now requires explicit source exhaustion with non-partial recall, or at least 90% estimated recall, for `healthy_complete`.
- Low-recall useful samples are now `usable_partial` or `degraded_under_extraction`.
- Generic acquisition now executes bounded `page`/`p` pagination for safe structured artifacts with repeated event-like arrays.
- Compatible record sets from paginated artifacts are merged before schema inference and normalization.
- Structured record-set selection now prefers validated sets that actually normalize to viable current events.

## Required Metrics

### Devpost

Same-source comparison target: `https://devpost.com/hackathons?status[]=upcoming&status[]=open&page=1`.

| Metric | Native | V2 Before | V2 After |
|---|---:|---:|---:|
| pages traversed | 12 | 1 | 20 |
| records observed | 108 fetched before native cap; API total 159 | 9 | 159 |
| valid events | 100 bounded by native maxResults | 8 | 116 |
| estimated available | 159 | 100+ / API total not surfaced | 159 |
| estimated recall | 63% against API total, capped | about 5-8% | 73% |
| precision | not manually sampled in this audit; native parser assumed high precision | high sample precision but tiny coverage | high sample precision; not labelled complete |
| duration | 1.3s | about 5.6s | 9.9s |
| stop reason | `maximum_cards_reached` | pagination not executed | `no_growth` after page-param pagination |

Loss-stage classification:

- V2 before: most lost records were `pagination not executed` / `never acquired`.
- V2 before: only page-one browser network JSON was acquired and normalized.
- V2 after: pagination is executed and records are observed; remaining losses are primarily `date/status filtered`, missing URL mapping completeness, and bounded generic schema limitations.
- No evidence of event-intent rejection as the dominant Devpost loss stage after the fix.

Conclusion: V2 materially improved, but at 73% estimated recall it is `usable_partial`, not complete. Native remains more suitable when the product needs compact, source-authoritative Devpost coverage with known public API semantics.

### MLH

Same-source comparison target: native starts at `https://www.mlh.com/events`, which redirects to the active season page.

| Metric | Native | V2 Before | V2 After |
|---|---:|---:|---:|
| pages traversed | 1 active season page | 1 wrong/older season page in prior Phase 5 run | 1 |
| records observed | 63 upcoming events | large structured/past data visible, but V2 selected tiny DOM output | 63 |
| valid events | 63 | 3 | 63 |
| estimated available | 63 | 60+ not surfaced correctly | 63 |
| estimated recall | 100% | about 5% | 100% |
| precision | high by native parser; V2 sample titles are event records | high sample precision but tiny coverage | high sample precision |
| duration | 2.5s | 3.4s | 1.9s |
| stop reason | active season page parsed | DOM fallback / wrong source comparison | no pagination needed |

Loss-stage classification:

- V2 before: the prior comparison used a different season URL and V2 selected a tiny DOM set instead of the structured `upcomingEvents` set.
- V2 after: structured selection now prefers record sets that normalize to viable current events, so `props.upcomingEvents` is selected.
- No pagination was required.

Conclusion: V2 is now suitable for MLH on the same source/horizon used by native collection.

### Hackathon Radar

Same-source comparison target: `https://www.hackathonradar.com/database`.

| Metric | Native | V2 Before | V2 After |
|---|---:|---:|---:|
| pages traversed | 1 | 1 root page, not database | 1 |
| records observed | 25 table rows | 10 from homepage JSON-LD/root-page sample | 3 DOM units |
| valid events | 25 | 10 | 3 |
| estimated available | 25 | substantially more than 10 based on native/history | 25 |
| estimated recall | 100% of public table rows observed | partial | 12% |
| precision | high for table rows | high but wrong/partial source | high sample precision but severe under-extraction |
| duration | 19.3s | 1.5s | 0.8s |
| stop reason | `page_fingerprint_unchanged` | bounded root-page sample | no page-param pagination |

Loss-stage classification:

- Prior Phase 5 comparison was not same-source: V2 used the homepage while native Hackathon Radar uses `/database`.
- V2 after on `/database`: loss is `record-set not discovered` and `schema mapping failed` for table rows.
- Pagination is not the cause; no generic page/action signal is available for this static table sample.
- Native custom collector has table-specific generic logic that V2 DOM inference does not yet match.

Conclusion: generic V2 is currently unsuitable for Hackathon Radar compared with the native custom-source collector. The correct behavior is to classify this as `degraded_under_extraction`, not healthy.

## Phase 4 vs Phase 5 Replay

The regression was not caused by event-intent validation rejecting good records globally.

- Devpost page-one artifacts replay through the same structured extraction path produce the same small page-one sample unless pagination is executed.
- MLH structured artifacts contain the needed `upcomingEvents`; the issue was record-set selection, not a validator rejection.
- Hackathon Radar `/database` artifacts do not produce a full generic repeated record set; this is a DOM/table inference coverage limitation.

## Stop Reasons

- Devpost native: full crawl until configured native cap, not source-total exhaustion.
- Devpost V2 before: bounded page-one sample; pagination not executed.
- Devpost V2 after: bounded generic pagination to no-growth; useful but still below 80% estimated recall.
- MLH native/V2 after: active season source fully represented by one structured page.
- Hackathon Radar V2 after: parser under-extraction; generic V2 does not discover the table record set.

## Decision

- Devpost: V2 improved materially but remains less suitable than native for authoritative coverage.
- MLH: V2 is suitable after the selection fix.
- Hackathon Radar: V2 is unsuitable; keep native custom-source collector for this source.

No V1 changes, no persistence, no production integration, no deployment, no merge, and no push to main.
