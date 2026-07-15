# Phase 5.3 Adaptive Crawl Benchmark

Date: 2026-07-15T00:13:52.276Z
Runtime: custom V2 only
Persistence: disabled

## Matrix

| Run | Profile | Sources | Stop | Pages | Actions | Raw records | Valid events | In horizon | Duplicates | Target coverage | Duration s | Source stops |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| profile-light | light | 6 | target_reached | 4 | 0 | 242 | 79 | 78 | 0 | 158% | 14.8 | devpost.com:request_cap; www.mlh.com:fetch_failed |
| profile-standard | standard | 6 | sources_exhausted | 15 | 1 | 572 | 142 | 107 | 0 | 95% | 28.1 | devpost.com:page_cap; www.mlh.com:fetch_failed; www.hackathonradar.com:no_growth; dorahacks.io:unknown; hackathons.space:no_growth; eventornado.com:unknown |
| profile-deep | deep | 6 | sources_exhausted | 37 | 1 | 1296 | 204 | 131 | 0 | 41% | 18.5 | www.hackathonradar.com:no_growth; www.mlh.com:fetch_failed; devpost.com:page_cap; dorahacks.io:unknown; hackathons.space:no_growth; eventornado.com:unknown |
| hackathons next 2 weeks | light | 6 | target_reached | 4 | 0 | 242 | 79 | 9 | 0 | 158% | 13.4 | devpost.com:request_cap; www.mlh.com:fetch_failed |
| hackathons next 2 months | light | 6 | target_reached | 4 | 0 | 242 | 79 | 24 | 0 | 158% | 12.2 | devpost.com:request_cap; www.mlh.com:fetch_failed |
| hackathons next 6 months | light | 6 | target_reached | 4 | 0 | 242 | 79 | 51 | 0 | 158% | 13.8 | devpost.com:request_cap; www.mlh.com:fetch_failed |

## Details

### profile-light

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: none to none
Stop: target_reached
Progress: batches 2, time to 10 6045 ms, time to 50 14836 ms, time to target 14836 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 15 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 63 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |

### profile-standard

Profile: standard
Persistence: disabled
Plan: target 150, max sources 10, max pages/source 8, max browser actions/source 2
Date horizon: none to none
Stop: sources_exhausted
Progress: batches 3, time to 10 7826 ms, time to 50 7826 ms, time to target n/a ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 54 | 44 | 54 | 0 | 8 | 0 | page_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 63 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |
| www.hackathonradar.com | 25 | 0 | 0 | 0 | 2 | 0 | no_growth | degraded_under_extraction | 24% |
| dorahacks.io | 0 | 0 | 0 | 0 | 1 | 0 | unknown | failed | 0% |
| hackathons.space | 0 | 0 | 0 | 0 | 1 | 1 | no_growth | failed | 0% |
| eventornado.com | 0 | 0 | 0 | 0 | 1 | 0 | unknown | failed | 0% |

### profile-deep

Profile: deep
Persistence: disabled
Plan: target 500, max sources 16, max pages/source 30, max browser actions/source 5
Date horizon: none to none
Stop: sources_exhausted
Progress: batches 3, time to 10 5706 ms, time to 50 7793 ms, time to target n/a ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| www.hackathonradar.com | 25 | 0 | 0 | 0 | 2 | 0 | no_growth | degraded_under_extraction | 24% |
| www.mlh.com | 63 | 63 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |
| devpost.com | 116 | 68 | 116 | 0 | 30 | 0 | page_cap | degraded_under_extraction | 1% |
| dorahacks.io | 0 | 0 | 0 | 0 | 1 | 0 | unknown | failed | 0% |
| hackathons.space | 0 | 0 | 0 | 0 | 1 | 1 | no_growth | failed | 0% |
| eventornado.com | 0 | 0 | 0 | 0 | 1 | 0 | unknown | failed | 0% |

### hackathons next 2 weeks

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: 2026-07-15T00:13:12.932Z to 2026-07-29T00:13:12.932Z
Stop: target_reached
Progress: batches 2, time to 10 5505 ms, time to 50 13356 ms, time to target 13356 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 5 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 4 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |

### hackathons next 2 months

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: 2026-07-15T00:13:26.289Z to 2026-09-15T00:13:26.289Z
Stop: target_reached
Progress: batches 2, time to 10 5406 ms, time to 50 12214 ms, time to target 12214 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 15 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 9 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |

### hackathons next 6 months

Profile: light
Persistence: disabled
Plan: target 50, max sources 4, max pages/source 3, max browser actions/source 1
Date horizon: 2026-07-15T00:13:38.504Z to 2027-01-15T00:13:38.504Z
Stop: target_reached
Progress: batches 2, time to 10 5428 ms, time to 50 13772 ms, time to target 13772 ms

| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| devpost.com | 16 | 15 | 16 | 0 | 2 | 0 | request_cap | degraded_under_extraction | 0% |
| www.mlh.com | 63 | 36 | 63 | 0 | 2 | 0 | fetch_failed | healthy_complete | 100% |
