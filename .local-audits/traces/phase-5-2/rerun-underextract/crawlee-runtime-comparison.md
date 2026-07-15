# Phase 5.2 Crawlee Runtime Comparison

Date: 2026-07-14T23:32:22.751Z
Persistence: disabled

## Matrix

| Site | Profile | Runtime | Quality | Pages | Records observed | Valid events | Estimated available | Estimated recall | Precision | Duplicate rate | Duration s | Stop reason |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Devpost | standard | custom | degraded_under_extraction | 8 | 327 | 54 | 13591 | 0% | 100% | 0% | 7.7 | page_cap |
| Devpost | standard | crawlee | degraded_under_extraction | 1 | 82 | 8 | 13591 | 0% | 100% | 0% | 9.8 | no_growth |
| Devpost | deep | custom | degraded_under_extraction | 20 | 726 | 116 | 13591 | 1% | 100% | 0% | 7.3 | page_cap |
| Devpost | deep | crawlee | degraded_under_extraction | 1 | 82 | 8 | 13591 | 0% | 100% | 0% | 8.7 | no_growth |
| Hackathon Radar | standard | custom | degraded_under_extraction | 2 | 36 | 3 | 100 | 3% | 100% | 0% | 0.6 | fetch_failed |
| Hackathon Radar | standard | crawlee | degraded_under_extraction | 2 | 36 | 3 | 100 | 3% | 100% | 0% | 2.7 | no_growth |
| Hackathon Radar | deep | custom | degraded_under_extraction | 2 | 36 | 3 | 100 | 3% | 100% | 0% | 0.5 | fetch_failed |
| Hackathon Radar | deep | crawlee | degraded_under_extraction | 2 | 36 | 3 | 100 | 3% | 100% | 0% | 2.5 | no_growth |

## Held-Out Sites

- HackerEarth: https://www.hackerearth.com/challenges/hackathon/
- Open Hackathons: https://www.openhackathons.org/s/upcoming-events
- AngelHack: https://angelhack.com/events/

## Precision Samples

### Devpost / standard / custom

Runtime: custom
Mode: browser
Stop reason: page_cap
Pagination executed: yes
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 0%
Precision estimate: 100%

Lead sample for manual precision review:

1. Vitalitics 2026
2. Ventura Challenge
3. DTI Hackathon 2026
4. AI YES :International Youth AI Competition
5. Brainwave 2026 – X402 Blockchain Track
6. Build with Gemini XPRIZE
7. OpenAI Build Week
8. Global AI Hackathon Series with Qwen Cloud
9. Reddit’s Games with a Hook Hackathon
10. CockroachDB × AWS Hackathon - Build with Agentic Memory
11. Arm Create: AI Optimization Challenge
12. Backblaze Generative Media Hackathon: Build with Genblaze on B2
13. Africa Deep Tech Challenge 2026
14. YouCam API Skin AI & Apparel VTO Hackathon
15. VoltHacks
16. SmartAIthon 2026
17. Hoobit Hacks 2026
18. Brainwave 2026
19. 3D Websites Hackathon
20. ImpactForge


### Devpost / standard / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_growth
Pagination executed: yes
Browser escalated: yes
Actions: 1/4
Quality: degraded_under_extraction
Estimated recall: 0%
Precision estimate: 100%

Lead sample for manual precision review:

1. Build with Gemini XPRIZE
2. OpenAI Build Week
3. Global AI Hackathon Series with Qwen Cloud
4. Reddit’s Games with a Hook Hackathon
5. CockroachDB × AWS Hackathon - Build with Agentic Memory
6. Arm Create: AI Optimization Challenge
7. Backblaze Generative Media Hackathon: Build with Genblaze on B2
8. Africa Deep Tech Challenge 2026


### Devpost / deep / custom

Runtime: custom
Mode: browser
Stop reason: page_cap
Pagination executed: yes
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 1%
Precision estimate: 100%

Lead sample for manual precision review:

1. DevsUnite Hiring Hackathon
2. MelonJam 7
3. Global Builders Hackathon: Code for Impact
4. Hack Atlantic
5. Build with Gemma NYC: On-Device AI for Healthcare
6. 757 BLD WKND 2026 2.0
7. Vitalitics 2026
8. Ventura Challenge
9. DTI Hackathon 2026
10. AI YES :International Youth AI Competition
11. Brainwave 2026 – X402 Blockchain Track
12. Build with Gemini XPRIZE
13. OpenAI Build Week
14. Global AI Hackathon Series with Qwen Cloud
15. Reddit’s Games with a Hook Hackathon
16. CockroachDB × AWS Hackathon - Build with Agentic Memory
17. Arm Create: AI Optimization Challenge
18. Backblaze Generative Media Hackathon: Build with Genblaze on B2
19. Africa Deep Tech Challenge 2026
20. YouCam API Skin AI & Apparel VTO Hackathon


### Devpost / deep / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_growth
Pagination executed: yes
Browser escalated: yes
Actions: 1/4
Quality: degraded_under_extraction
Estimated recall: 0%
Precision estimate: 100%

Lead sample for manual precision review:

1. Build with Gemini XPRIZE
2. OpenAI Build Week
3. Global AI Hackathon Series with Qwen Cloud
4. Reddit’s Games with a Hook Hackathon
5. CockroachDB × AWS Hackathon - Build with Agentic Memory
6. Arm Create: AI Optimization Challenge
7. Backblaze Generative Media Hackathon: Build with Genblaze on B2
8. Africa Deep Tech Challenge 2026


### Hackathon Radar / standard / custom

Runtime: custom
Mode: static
Stop reason: fetch_failed
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 3%
Precision estimate: 100%

Lead sample for manual precision review:

1. ExploreDatabaseDiscoverMapStatsOrganizersSponsorsFor JudgesHack Passport - https://www.hackathonradar.com/database
2. EnterpriseEnterprise SponsorsAPI DocsUse CasesContact - https://www.hackathonradar.com/enterprise-sponsors
3. ResourcesBlogState of HackathonsCase StudySponsorship GuideFeature Your Hackathon - https://www.hackathonradar.com/blog


### Hackathon Radar / standard / crawlee

Runtime: crawlee
Mode: static
Stop reason: no_growth
Pagination executed: yes
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 3%
Precision estimate: 100%

Lead sample for manual precision review:

1. ExploreDatabaseDiscoverMapStatsOrganizersSponsorsFor JudgesHack Passport - https://www.hackathonradar.com/database
2. EnterpriseEnterprise SponsorsAPI DocsUse CasesContact - https://www.hackathonradar.com/enterprise-sponsors
3. ResourcesBlogState of HackathonsCase StudySponsorship GuideFeature Your Hackathon - https://www.hackathonradar.com/blog


### Hackathon Radar / deep / custom

Runtime: custom
Mode: static
Stop reason: fetch_failed
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 3%
Precision estimate: 100%

Lead sample for manual precision review:

1. ExploreDatabaseDiscoverMapStatsOrganizersSponsorsFor JudgesHack Passport - https://www.hackathonradar.com/database
2. EnterpriseEnterprise SponsorsAPI DocsUse CasesContact - https://www.hackathonradar.com/enterprise-sponsors
3. ResourcesBlogState of HackathonsCase StudySponsorship GuideFeature Your Hackathon - https://www.hackathonradar.com/blog


### Hackathon Radar / deep / crawlee

Runtime: crawlee
Mode: static
Stop reason: no_growth
Pagination executed: yes
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 3%
Precision estimate: 100%

Lead sample for manual precision review:

1. ExploreDatabaseDiscoverMapStatsOrganizersSponsorsFor JudgesHack Passport - https://www.hackathonradar.com/database
2. EnterpriseEnterprise SponsorsAPI DocsUse CasesContact - https://www.hackathonradar.com/enterprise-sponsors
3. ResourcesBlogState of HackathonsCase StudySponsorship GuideFeature Your Hackathon - https://www.hackathonradar.com/blog

