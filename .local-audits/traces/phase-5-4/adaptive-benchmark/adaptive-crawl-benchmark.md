# Phase 5.3 Adaptive Crawl Benchmark

Date: 2026-07-15T00:44:29.820Z
Runtime: custom V2 only
Persistence: disabled

## Matrix

| Run | Profile | Sources | Stop | Pages | Actions | Raw records | Valid events | In horizon | Duplicates | Target coverage | Duration s | Source stops |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| profile-light | light | 6 | target_reached | 4 | 0 | 242 | 79 | 78 | 0 | 158% | 15.3 | devpost.com:request_cap; www.mlh.com:fetch_failed |
| profile-standard | standard | 6 | target_reached | 15 | 1 | 572 | 154 | 119 | 0 | 103% | 30.3 | devpost.com:page_cap; www.mlh.com:fetch_failed; www.hackathonradar.com:no_growth; dorahacks.io:unknown; eventornado.com:unknown; hackathons.space:no_growth |
| profile-deep | deep | 6 | sources_exhausted | 37 | 1 | 1296 | 216 | 143 | 0 | 43% | 28.1 | www.hackathonradar.com:no_growth; www.mlh.com:fetch_failed; devpost.com:page_cap; dorahacks.io:unknown; eventornado.com:unknown; hackathons.space:no_growth |
| hackathons next 2 weeks | light | 6 | target_reached | 4 | 0 | 242 | 79 | 9 | 0 | 158% | 16.2 | devpost.com:request_cap; www.mlh.com:fetch_failed |
| hackathons next 2 months | light | 6 | target_reached | 4 | 0 | 242 | 79 | 24 | 0 | 158% | 16.1 | devpost.com:request_cap; www.mlh.com:fetch_failed |
| hackathons next 6 months | light | 6 | target_reached | 4 | 0 | 242 | 79 | 51 | 0 | 158% | 18.2 | devpost.com:request_cap; www.mlh.com:fetch_failed |

## Details

### profile-light

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: none to none
Stop: target_reached
Progress: batches 2, time to 10 6454 ms, time to 50 15300 ms, time to target 15300 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 15 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 63 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |

### profile-standard

Profile: standard
Persistence: disabled
Plan: target 150, max sources 10, max pages/source 8, max browser actions/source 2
Date horizon: none to none
Stop: target_reached
Progress: batches 4, time to 10 8276 ms, time to 50 8276 ms, time to target 30256 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 54 | 44 | 54 | 0 | 8 | 0 | page_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 63 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |
| www.hackathonradar.com | 25 | 0 | 0 | 0 | 2 | 0 | no_growth | degraded_under_extraction | 24% |
| dorahacks.io | 0 | 0 | 0 | 0 | 1 | 0 | unknown | failed | 0% |
| eventornado.com | 0 | 0 | 0 | 0 | 1 | 0 | unknown | failed | 0% |
| hackathons.space | 12 | 12 | 0 | 0 | 1 | 1 | no_growth | healthy_complete | 100% |

### profile-deep

Profile: deep
Persistence: disabled
Plan: target 500, max sources 16, max pages/source 30, max browser actions/source 5
Date horizon: none to none
Stop: sources_exhausted
Progress: batches 4, time to 10 8973 ms, time to 50 11152 ms, time to target n/a ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| www.hackathonradar.com | 25 | 0 | 0 | 0 | 2 | 0 | no_growth | degraded_under_extraction | 24% |
| www.mlh.com | 63 | 63 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |
| devpost.com | 116 | 68 | 116 | 0 | 30 | 0 | page_cap | degraded_under_extraction | 1% |
| dorahacks.io | 0 | 0 | 0 | 0 | 1 | 0 | unknown | failed | 0% |
| eventornado.com | 0 | 0 | 0 | 0 | 1 | 0 | unknown | failed | 0% |
| hackathons.space | 12 | 12 | 0 | 0 | 1 | 1 | no_growth | healthy_complete | 100% |

### hackathons next 2 weeks

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: 2026-07-15T00:43:39.328Z to 2026-07-29T00:43:39.328Z
Stop: target_reached
Progress: batches 2, time to 10 6447 ms, time to 50 16178 ms, time to target 16178 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 5 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 4 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |

### hackathons next 2 months

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: 2026-07-15T00:43:55.508Z to 2026-09-15T00:43:55.508Z
Stop: target_reached
Progress: batches 2, time to 10 5996 ms, time to 50 16088 ms, time to target 16088 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 15 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 9 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |

### hackathons next 6 months

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: 2026-07-15T00:44:11.600Z to 2027-01-15T00:44:11.600Z
Stop: target_reached
Progress: batches 2, time to 10 6862 ms, time to 50 18220 ms, time to target 18220 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 15 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 36 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |
