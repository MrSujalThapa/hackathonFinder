# Phase 5.2 Crawlee Runtime Comparison

Date: 2026-07-14T23:35:54.325Z
Persistence: disabled

## Matrix

| Site | Profile | Runtime | Quality | Pages | Records observed | Valid events | Estimated available | Estimated recall | Precision | Duplicate rate | Duration s | Stop reason |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| DoraHacks | standard | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 7.8 | unknown |
| DoraHacks | standard | crawlee | degraded_under_extraction | 1 | 104 | 2 | 24 | 8% | 100% | 0% | 14.7 | no_page_param |
| DoraHacks | deep | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 5.9 | unknown |
| DoraHacks | deep | crawlee | degraded_under_extraction | 1 | 104 | 2 | 24 | 8% | 100% | 0% | 12.2 | no_page_param |

## Held-Out Sites

- HackerEarth: https://www.hackerearth.com/challenges/hackathon/
- Open Hackathons: https://www.openhackathons.org/s/upcoming-events
- AngelHack: https://angelhack.com/events/

## Precision Samples

### DoraHacks / standard / custom

Runtime: custom
Mode: browser
Stop reason: unknown
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: failed
Estimated recall: 0%
Precision estimate: 0%

Lead sample for manual precision review:

No leads extracted.

### DoraHacks / standard / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/1
Quality: degraded_under_extraction
Estimated recall: 8%
Precision estimate: 100%

Lead sample for manual precision review:

1. Terms and Conditions - https://dorahacks.io/terms-and-conditions
2. Rules - https://dorahacks.io/rules


### DoraHacks / deep / custom

Runtime: custom
Mode: browser
Stop reason: unknown
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: failed
Estimated recall: 0%
Precision estimate: 0%

Lead sample for manual precision review:

No leads extracted.

### DoraHacks / deep / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/1
Quality: degraded_under_extraction
Estimated recall: 8%
Precision estimate: 100%

Lead sample for manual precision review:

1. Terms and Conditions - https://dorahacks.io/terms-and-conditions
2. Rules - https://dorahacks.io/rules

