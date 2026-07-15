# Phase 5.3 Adaptive Crawl Benchmark

Date: 2026-07-15T01:44:58.917Z
Runtime: custom V2 only
Persistence: disabled

## Matrix

| Run | Profile | Sources | Stop | Pages | Actions | Raw records | Valid events | In horizon | Duplicates | Target coverage | Duration s | Source stops |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| profile-light | light | 6 | target_reached | 4 | 0 | 242 | 79 | 78 | 0 | 158% | 17.4 | devpost.com:request_cap; www.mlh.com:fetch_failed |
| profile-standard | standard | 6 | target_reached | 15 | 1 | 572 | 154 | 119 | 0 | 103% | 47.4 | www.mlh.com:fetch_failed; devpost.com:page_cap; dorahacks.io:unknown; www.hackathonradar.com:no_growth; eventornado.com:unknown; hackathons.space:no_growth |
| profile-deep | deep | 6 | sources_exhausted | 37 | 1 | 1296 | 216 | 143 | 0 | 43% | 43.5 | www.mlh.com:fetch_failed; devpost.com:page_cap; www.hackathonradar.com:no_growth; dorahacks.io:unknown; eventornado.com:unknown; hackathons.space:no_growth |
| hackathons next 2 weeks | light | 6 | target_reached | 4 | 0 | 242 | 79 | 9 | 0 | 158% | 15.9 | devpost.com:request_cap; www.mlh.com:fetch_failed |
| hackathons next 2 months | light | 6 | sources_exhausted | 5 | 0 | 239 | 43 | 15 | 0 | 86% | 33.5 | devpost.com:request_cap; www.mlh.com:unknown; www.hackathonradar.com:page_cap; dorahacks.io:unknown |
| hackathons next 6 months | light | 6 | target_reached | 4 | 0 | 242 | 79 | 53 | 0 | 158% | 16.2 | devpost.com:request_cap; www.mlh.com:fetch_failed |

## Details

### profile-light

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: none to none
Stop: target_reached
Progress: batches 2, time to 10 7057 ms, time to 50 17382 ms, time to target 17382 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 15 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 63 | 63 | 0 | 2 | 0 | fetch_failed | degraded_under_extraction | 8% |

### profile-standard

Profile: standard
Persistence: disabled
Plan: target 150, max sources 10, max pages/source 8, max browser actions/source 2
Date horizon: none to none
Stop: target_reached
Progress: batches 4, time to 10 9941 ms, time to 50 9941 ms, time to target 47364 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| www.mlh.com | 63 | 63 | 63 | 0 | 2 | 0 | fetch_failed | degraded_under_extraction | 8% |
| devpost.com | 54 | 44 | 54 | 0 | 8 | 0 | page_cap | degraded_under_extraction | 0% |
| dorahacks.io | 0 | 0 | 0 | 0 | 1 | 0 | unknown | blocked | 0% |
| www.hackathonradar.com | 25 | 0 | 0 | 0 | 2 | 0 | no_growth | degraded_under_extraction | 4% |
| eventornado.com | 0 | 0 | 0 | 0 | 1 | 0 | unknown | failed | 0% |
| hackathons.space | 12 | 12 | 0 | 0 | 1 | 1 | no_growth | degraded_under_extraction | 6% |

### profile-deep

Profile: deep
Persistence: disabled
Plan: target 500, max sources 16, max pages/source 30, max browser actions/source 5
Date horizon: none to none
Stop: sources_exhausted
Progress: batches 4, time to 10 9863 ms, time to 50 9863 ms, time to target n/a ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| www.mlh.com | 63 | 63 | 63 | 0 | 2 | 0 | fetch_failed | degraded_under_extraction | 8% |
| devpost.com | 116 | 68 | 116 | 0 | 30 | 0 | page_cap | degraded_under_extraction | 1% |
| www.hackathonradar.com | 25 | 0 | 0 | 0 | 2 | 0 | no_growth | degraded_under_extraction | 4% |
| dorahacks.io | 0 | 0 | 0 | 0 | 1 | 0 | unknown | blocked | 0% |
| eventornado.com | 0 | 0 | 0 | 0 | 1 | 0 | unknown | failed | 0% |
| hackathons.space | 12 | 12 | 0 | 0 | 1 | 1 | no_growth | degraded_under_extraction | 6% |

### hackathons next 2 weeks

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: 2026-07-15T01:43:53.280Z to 2026-07-29T01:43:53.280Z
Stop: target_reached
Progress: batches 2, time to 10 6398 ms, time to 50 15946 ms, time to target 15946 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 5 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 4 | 63 | 0 | 2 | 0 | fetch_failed | degraded_under_extraction | 8% |

### hackathons next 2 months

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: 2026-07-15T01:44:09.235Z to 2026-09-15T01:44:09.235Z
Stop: sources_exhausted
Progress: batches 3, time to 10 6534 ms, time to 50 n/a ms, time to target n/a ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 15 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 2 | 0 | 0 | 0 | 1 | 0 | unknown | degraded_under_extraction | 0% |
| www.hackathonradar.com | 25 | 0 | 0 | 0 | 1 | 0 | page_cap | degraded_under_extraction | 4% |
| dorahacks.io | 0 | 0 | 0 | 0 | 1 | 0 | unknown | blocked | 0% |

### hackathons next 6 months

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: 2026-07-15T01:44:42.763Z to 2027-01-15T01:44:42.763Z
Stop: target_reached
Progress: batches 2, time to 10 7012 ms, time to 50 16153 ms, time to target 16153 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 15 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 38 | 63 | 0 | 2 | 0 | fetch_failed | degraded_under_extraction | 8% |
