# Phase 5.2 Crawlee Runtime Comparison

Date: 2026-07-14T23:41:24.972Z
Persistence: disabled

## Matrix

| Site | Profile | Runtime | Quality | Pages | Records observed | Valid events | Estimated available | Estimated recall | Precision | Duplicate rate | Duration s | Stop reason |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Hackathon Radar | quick | custom | degraded_under_extraction | 2 | 16 | 3 | 25 | 12% | 100% | 0% | 1.2 | fetch_failed |
| Hackathon Radar | quick | crawlee | degraded_under_extraction | 1 | 16 | 3 | 25 | 12% | 100% | 0% | 2.9 | no_page_param |
| Hackathon Radar | standard | custom | degraded_under_extraction | 2 | 16 | 3 | 25 | 12% | 100% | 0% | 0.7 | fetch_failed |
| Hackathon Radar | standard | crawlee | degraded_under_extraction | 1 | 16 | 3 | 25 | 12% | 100% | 0% | 1.8 | no_page_param |
| Hackathon Radar | deep | custom | degraded_under_extraction | 2 | 16 | 3 | 25 | 12% | 100% | 0% | 0.7 | fetch_failed |
| Hackathon Radar | deep | crawlee | degraded_under_extraction | 1 | 16 | 3 | 25 | 12% | 100% | 0% | 1.7 | no_page_param |

## Held-Out Sites

- HackerEarth: https://www.hackerearth.com/challenges/hackathon/
- Open Hackathons: https://www.openhackathons.org/s/upcoming-events
- AngelHack: https://angelhack.com/events/

## Precision Samples

### Hackathon Radar / quick / custom

Runtime: custom
Mode: static
Stop reason: fetch_failed
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 12%
Precision estimate: 100%

Lead sample for manual precision review:

1. HackathonsBrowseJudge OpportunitiesSponsorsOrganizersMapDiscover - https://www.hackathonradar.com/judge-opportunities
2. ExploreStatsState of HackathonsChangelog - https://www.hackathonradar.com/stats
3. PersonalPassportFavoritesSettings - https://www.hackathonradar.com/passport


### Hackathon Radar / quick / crawlee

Runtime: crawlee
Mode: static
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 12%
Precision estimate: 100%

Lead sample for manual precision review:

1. HackathonsBrowseJudge OpportunitiesSponsorsOrganizersMapDiscover - https://www.hackathonradar.com/judge-opportunities
2. ExploreStatsState of HackathonsChangelog - https://www.hackathonradar.com/stats
3. PersonalPassportFavoritesSettings - https://www.hackathonradar.com/passport


### Hackathon Radar / standard / custom

Runtime: custom
Mode: static
Stop reason: fetch_failed
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 12%
Precision estimate: 100%

Lead sample for manual precision review:

1. HackathonsBrowseJudge OpportunitiesSponsorsOrganizersMapDiscover - https://www.hackathonradar.com/judge-opportunities
2. ExploreStatsState of HackathonsChangelog - https://www.hackathonradar.com/stats
3. PersonalPassportFavoritesSettings - https://www.hackathonradar.com/passport


### Hackathon Radar / standard / crawlee

Runtime: crawlee
Mode: static
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 12%
Precision estimate: 100%

Lead sample for manual precision review:

1. HackathonsBrowseJudge OpportunitiesSponsorsOrganizersMapDiscover - https://www.hackathonradar.com/judge-opportunities
2. ExploreStatsState of HackathonsChangelog - https://www.hackathonradar.com/stats
3. PersonalPassportFavoritesSettings - https://www.hackathonradar.com/passport


### Hackathon Radar / deep / custom

Runtime: custom
Mode: static
Stop reason: fetch_failed
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 12%
Precision estimate: 100%

Lead sample for manual precision review:

1. HackathonsBrowseJudge OpportunitiesSponsorsOrganizersMapDiscover - https://www.hackathonradar.com/judge-opportunities
2. ExploreStatsState of HackathonsChangelog - https://www.hackathonradar.com/stats
3. PersonalPassportFavoritesSettings - https://www.hackathonradar.com/passport


### Hackathon Radar / deep / crawlee

Runtime: crawlee
Mode: static
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 12%
Precision estimate: 100%

Lead sample for manual precision review:

1. HackathonsBrowseJudge OpportunitiesSponsorsOrganizersMapDiscover - https://www.hackathonradar.com/judge-opportunities
2. ExploreStatsState of HackathonsChangelog - https://www.hackathonradar.com/stats
3. PersonalPassportFavoritesSettings - https://www.hackathonradar.com/passport

