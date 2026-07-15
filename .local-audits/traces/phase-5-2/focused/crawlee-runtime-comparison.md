# Phase 5.2 Crawlee Runtime Comparison

Date: 2026-07-14T23:31:05.475Z
Persistence: disabled

## Matrix

| Site | Profile | Runtime | Quality | Pages | Records observed | Valid events | Estimated available | Estimated recall | Precision | Duplicate rate | Duration s | Stop reason |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Devpost | standard | custom | degraded_under_extraction | 8 | 327 | 54 | 13591 | 0% | 100% | 0% | 6.3 | page_cap |
| Devpost | standard | crawlee | degraded_under_extraction | 1 | 82 | 8 | 13591 | 0% | 100% | 0% | 10.3 | no_growth |
| Devpost | deep | custom | degraded_under_extraction | 20 | 726 | 116 | 13591 | 1% | 100% | 0% | 7.8 | page_cap |
| Devpost | deep | crawlee | degraded_under_extraction | 1 | 82 | 8 | 13591 | 0% | 100% | 0% | 8.5 | no_growth |
| MLH | standard | custom | healthy_complete | 2 | 124 | 63 | 63 | 100% | 100% | 0% | 2.9 | fetch_failed |
| MLH | standard | crawlee | healthy_complete | 1 | 124 | 63 | 63 | 100% | 100% | 0% | 3.2 | no_page_param |
| MLH | deep | custom | healthy_complete | 2 | 124 | 63 | 63 | 100% | 100% | 0% | 2.6 | fetch_failed |
| MLH | deep | crawlee | healthy_complete | 1 | 124 | 63 | 63 | 100% | 100% | 0% | 3.0 | no_page_param |
| Hackathon Radar | standard | custom | degraded_under_extraction | 2 | 36 | 3 | 100 | 3% | 100% | 0% | 0.6 | fetch_failed |
| Hackathon Radar | standard | crawlee | degraded_under_extraction | 2 | 36 | 3 | 100 | 3% | 100% | 0% | 2.6 | no_growth |
| Hackathon Radar | deep | custom | degraded_under_extraction | 2 | 36 | 3 | 100 | 3% | 100% | 0% | 0.6 | fetch_failed |
| Hackathon Radar | deep | crawlee | degraded_under_extraction | 2 | 36 | 3 | 100 | 3% | 100% | 0% | 2.4 | no_growth |
| Garage48 | standard | custom | healthy_complete | 1 | 0 | 194 | 194 | 100% | 100% | 0% | 5.2 | no_page_param |
| Garage48 | standard | crawlee | healthy_complete | 1 | 0 | 194 | 194 | 100% | 100% | 0% | 8.4 | no_page_param |
| Garage48 | deep | custom | healthy_complete | 1 | 0 | 194 | 194 | 100% | 100% | 0% | 5.1 | no_page_param |
| Garage48 | deep | crawlee | healthy_complete | 1 | 0 | 194 | 194 | 100% | 100% | 0% | 8.0 | no_page_param |
| DoraHacks | standard | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 6.7 | unknown |
| DoraHacks | standard | crawlee | usable_partial | 1 | 104 | 20 | 24 | 83% | 100% | 0% | 13.0 | no_page_param |
| DoraHacks | deep | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 8.2 | unknown |
| DoraHacks | deep | crawlee | usable_partial | 1 | 104 | 20 | 24 | 83% | 100% | 0% | 12.2 | no_page_param |
| hackathons.space | standard | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 7.3 | no_page_param |
| hackathons.space | standard | crawlee | failed | 2 | 0 | 0 | unknown | 0% | 0% | 0% | 17.3 | no_growth |
| hackathons.space | deep | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 5.3 | no_page_param |
| hackathons.space | deep | crawlee | failed | 2 | 0 | 0 | unknown | 0% | 0% | 0% | 14.8 | no_growth |
| Eventornado | standard | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 3.0 | unknown |
| Eventornado | standard | crawlee | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 6.5 | no_page_param |
| Eventornado | deep | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 2.8 | unknown |
| Eventornado | deep | crawlee | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 6.5 | no_page_param |

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


### MLH / standard / custom

Runtime: custom
Mode: static
Stop reason: fetch_failed
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Global Hack Week: Season Launch - https://www.mlh.com/global-hack-week-season-launch-46
2. Midnight Virtual Hackathon - https://www.mlh.com/midnight-virtual-hackathon
3. Hack the 6ix - https://www.mlh.com/hack-the-6ix-cf
4. Hexafalls 2 - https://www.mlh.com/hexafalls-2
5. Global Hack Week: Agents - https://www.mlh.com/global-hack-week-agents
6. PEC HACKS 4.0 - https://www.mlh.com/pec-hacks-4-0
7. HackMTY - https://www.mlh.com/hackmty-2026
8. Global Hack Week: Data - https://www.mlh.com/global-hack-week-data
9. HackRice - https://www.mlh.com/hackrice-71
10. VTHacks 14 - https://www.mlh.com/vthacks-14
11. Hack the North - https://www.mlh.com/hack-the-north-e8
12. HopHacks - https://www.mlh.com/hophacks-40-1ae4
13. SteelHacks XIII - https://www.mlh.com/steelhacks-xiii
14. HackGT 13 - https://www.mlh.com/hackgt-13
15. ShellHacks - https://www.mlh.com/shellhacks-b9
16. hackUMBC - https://www.mlh.com/hackumbc-9b
17. DivHacks - https://www.mlh.com/divhacks-14
18. BigRed//Hacks 2026 - https://www.mlh.com/bigred-hacks-2026
19. Hack Dearborn 5: Conjure Reality - https://www.mlh.com/hack-dearborn-5-conjure-reality
20. Rowdy Hacks - https://www.mlh.com/rowdy-hacks


### MLH / standard / crawlee

Runtime: crawlee
Mode: static
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Global Hack Week: Season Launch - https://www.mlh.com/global-hack-week-season-launch-46
2. Midnight Virtual Hackathon - https://www.mlh.com/midnight-virtual-hackathon
3. Hack the 6ix - https://www.mlh.com/hack-the-6ix-cf
4. Hexafalls 2 - https://www.mlh.com/hexafalls-2
5. Global Hack Week: Agents - https://www.mlh.com/global-hack-week-agents
6. PEC HACKS 4.0 - https://www.mlh.com/pec-hacks-4-0
7. HackMTY - https://www.mlh.com/hackmty-2026
8. Global Hack Week: Data - https://www.mlh.com/global-hack-week-data
9. HackRice - https://www.mlh.com/hackrice-71
10. VTHacks 14 - https://www.mlh.com/vthacks-14
11. Hack the North - https://www.mlh.com/hack-the-north-e8
12. HopHacks - https://www.mlh.com/hophacks-40-1ae4
13. SteelHacks XIII - https://www.mlh.com/steelhacks-xiii
14. HackGT 13 - https://www.mlh.com/hackgt-13
15. ShellHacks - https://www.mlh.com/shellhacks-b9
16. hackUMBC - https://www.mlh.com/hackumbc-9b
17. DivHacks - https://www.mlh.com/divhacks-14
18. BigRed//Hacks 2026 - https://www.mlh.com/bigred-hacks-2026
19. Hack Dearborn 5: Conjure Reality - https://www.mlh.com/hack-dearborn-5-conjure-reality
20. Rowdy Hacks - https://www.mlh.com/rowdy-hacks


### MLH / deep / custom

Runtime: custom
Mode: static
Stop reason: fetch_failed
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Global Hack Week: Season Launch - https://www.mlh.com/global-hack-week-season-launch-46
2. Midnight Virtual Hackathon - https://www.mlh.com/midnight-virtual-hackathon
3. Hack the 6ix - https://www.mlh.com/hack-the-6ix-cf
4. Hexafalls 2 - https://www.mlh.com/hexafalls-2
5. Global Hack Week: Agents - https://www.mlh.com/global-hack-week-agents
6. PEC HACKS 4.0 - https://www.mlh.com/pec-hacks-4-0
7. HackMTY - https://www.mlh.com/hackmty-2026
8. Global Hack Week: Data - https://www.mlh.com/global-hack-week-data
9. HackRice - https://www.mlh.com/hackrice-71
10. VTHacks 14 - https://www.mlh.com/vthacks-14
11. Hack the North - https://www.mlh.com/hack-the-north-e8
12. HopHacks - https://www.mlh.com/hophacks-40-1ae4
13. SteelHacks XIII - https://www.mlh.com/steelhacks-xiii
14. HackGT 13 - https://www.mlh.com/hackgt-13
15. ShellHacks - https://www.mlh.com/shellhacks-b9
16. hackUMBC - https://www.mlh.com/hackumbc-9b
17. DivHacks - https://www.mlh.com/divhacks-14
18. BigRed//Hacks 2026 - https://www.mlh.com/bigred-hacks-2026
19. Hack Dearborn 5: Conjure Reality - https://www.mlh.com/hack-dearborn-5-conjure-reality
20. Rowdy Hacks - https://www.mlh.com/rowdy-hacks


### MLH / deep / crawlee

Runtime: crawlee
Mode: static
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Global Hack Week: Season Launch - https://www.mlh.com/global-hack-week-season-launch-46
2. Midnight Virtual Hackathon - https://www.mlh.com/midnight-virtual-hackathon
3. Hack the 6ix - https://www.mlh.com/hack-the-6ix-cf
4. Hexafalls 2 - https://www.mlh.com/hexafalls-2
5. Global Hack Week: Agents - https://www.mlh.com/global-hack-week-agents
6. PEC HACKS 4.0 - https://www.mlh.com/pec-hacks-4-0
7. HackMTY - https://www.mlh.com/hackmty-2026
8. Global Hack Week: Data - https://www.mlh.com/global-hack-week-data
9. HackRice - https://www.mlh.com/hackrice-71
10. VTHacks 14 - https://www.mlh.com/vthacks-14
11. Hack the North - https://www.mlh.com/hack-the-north-e8
12. HopHacks - https://www.mlh.com/hophacks-40-1ae4
13. SteelHacks XIII - https://www.mlh.com/steelhacks-xiii
14. HackGT 13 - https://www.mlh.com/hackgt-13
15. ShellHacks - https://www.mlh.com/shellhacks-b9
16. hackUMBC - https://www.mlh.com/hackumbc-9b
17. DivHacks - https://www.mlh.com/divhacks-14
18. BigRed//Hacks 2026 - https://www.mlh.com/bigred-hacks-2026
19. Hack Dearborn 5: Conjure Reality - https://www.mlh.com/hack-dearborn-5-conjure-reality
20. Rowdy Hacks - https://www.mlh.com/rowdy-hacks


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


### Garage48 / standard / custom

Runtime: custom
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Garage48 15-Year Anniversary Hackathon - https://garage48.org/events/g48anniversaryhack15
2. Tech for Agriculture Kenya Edition - https://garage48.org/events/techforagriculturekenya
3. Hack the Border - https://garage48.org/events/hack-the-border
4. Empowering Women Idea Garage - https://garage48.org/events/empowering-women-eesti-ettevotlusprogramm
5. Empowering Women: Digitalisation and Export Acceleration 2025 - https://garage48.org/events/empowering-women-digitalisation-and-export-acceleration-2025
6. Female Founders Academy - https://garage48.org/events/femalefoundersacademynairobi
7. Klavani Jalkahäkk - https://garage48.org/events/klavani-jalkahakk-1
8. Hack the Future - https://garage48.org/events/hack-the-future
9. Minu Lääne-Virumaa Hackathon - https://garage48.org/events/minu-laane-viru-hackathon
10. Empowering Women Ettevõtlusprogramm - https://garage48.org/events/empowering-women-ettevotlusprogramm
11. Häkaton Andmetorm 2024 - https://garage48.org/events/andmetorm
12. EdTech Hackathon in Armenia - https://garage48.org/events/edtech-armenia
13. Green Growth AgriHack - https://garage48.org/events/greengrowth-agrihack
14. Empowering Women Mentorite Meistriklass - https://garage48.org/events/empowering-women-mentorite-meistriklass
15. Empowering Women Idee Garage - https://garage48.org/events/empowering-women-idee-garage
16. Empowering Women: Digitalisation and Export Acceleration - https://garage48.org/events/empowering-women
17. Ecotech Hackathon- Making Urban Water Smart - https://garage48.org/events/ecotechhackathon
18. #OceanHack4EU - https://garage48.org/events/oceanhack4eu
19. Empowering Women Ukraine 2024 ACCELERATION: Entrepreneurship programme for business development - https://garage48.org/events/empowering-women-ukraine-2024-acceleration-entrepreneurship-programme-for-business-development
20. DIGI-GREEN HACKATHON - https://garage48.org/events/digi-green-hackathon


### Garage48 / standard / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/0
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Garage48 15-Year Anniversary Hackathon - https://garage48.org/events/g48anniversaryhack15
2. Tech for Agriculture Kenya Edition - https://garage48.org/events/techforagriculturekenya
3. Hack the Border - https://garage48.org/events/hack-the-border
4. Empowering Women Idea Garage - https://garage48.org/events/empowering-women-eesti-ettevotlusprogramm
5. Empowering Women: Digitalisation and Export Acceleration 2025 - https://garage48.org/events/empowering-women-digitalisation-and-export-acceleration-2025
6. Female Founders Academy - https://garage48.org/events/femalefoundersacademynairobi
7. Klavani Jalkahäkk - https://garage48.org/events/klavani-jalkahakk-1
8. Hack the Future - https://garage48.org/events/hack-the-future
9. Minu Lääne-Virumaa Hackathon - https://garage48.org/events/minu-laane-viru-hackathon
10. Empowering Women Ettevõtlusprogramm - https://garage48.org/events/empowering-women-ettevotlusprogramm
11. Häkaton Andmetorm 2024 - https://garage48.org/events/andmetorm
12. EdTech Hackathon in Armenia - https://garage48.org/events/edtech-armenia
13. Green Growth AgriHack - https://garage48.org/events/greengrowth-agrihack
14. Empowering Women Mentorite Meistriklass - https://garage48.org/events/empowering-women-mentorite-meistriklass
15. Empowering Women Idee Garage - https://garage48.org/events/empowering-women-idee-garage
16. Empowering Women: Digitalisation and Export Acceleration - https://garage48.org/events/empowering-women
17. Ecotech Hackathon- Making Urban Water Smart - https://garage48.org/events/ecotechhackathon
18. #OceanHack4EU - https://garage48.org/events/oceanhack4eu
19. Empowering Women Ukraine 2024 ACCELERATION: Entrepreneurship programme for business development - https://garage48.org/events/empowering-women-ukraine-2024-acceleration-entrepreneurship-programme-for-business-development
20. DIGI-GREEN HACKATHON - https://garage48.org/events/digi-green-hackathon


### Garage48 / deep / custom

Runtime: custom
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Garage48 15-Year Anniversary Hackathon - https://garage48.org/events/g48anniversaryhack15
2. Tech for Agriculture Kenya Edition - https://garage48.org/events/techforagriculturekenya
3. Hack the Border - https://garage48.org/events/hack-the-border
4. Empowering Women Idea Garage - https://garage48.org/events/empowering-women-eesti-ettevotlusprogramm
5. Empowering Women: Digitalisation and Export Acceleration 2025 - https://garage48.org/events/empowering-women-digitalisation-and-export-acceleration-2025
6. Female Founders Academy - https://garage48.org/events/femalefoundersacademynairobi
7. Klavani Jalkahäkk - https://garage48.org/events/klavani-jalkahakk-1
8. Hack the Future - https://garage48.org/events/hack-the-future
9. Minu Lääne-Virumaa Hackathon - https://garage48.org/events/minu-laane-viru-hackathon
10. Empowering Women Ettevõtlusprogramm - https://garage48.org/events/empowering-women-ettevotlusprogramm
11. Häkaton Andmetorm 2024 - https://garage48.org/events/andmetorm
12. EdTech Hackathon in Armenia - https://garage48.org/events/edtech-armenia
13. Green Growth AgriHack - https://garage48.org/events/greengrowth-agrihack
14. Empowering Women Mentorite Meistriklass - https://garage48.org/events/empowering-women-mentorite-meistriklass
15. Empowering Women Idee Garage - https://garage48.org/events/empowering-women-idee-garage
16. Empowering Women: Digitalisation and Export Acceleration - https://garage48.org/events/empowering-women
17. Ecotech Hackathon- Making Urban Water Smart - https://garage48.org/events/ecotechhackathon
18. #OceanHack4EU - https://garage48.org/events/oceanhack4eu
19. Empowering Women Ukraine 2024 ACCELERATION: Entrepreneurship programme for business development - https://garage48.org/events/empowering-women-ukraine-2024-acceleration-entrepreneurship-programme-for-business-development
20. DIGI-GREEN HACKATHON - https://garage48.org/events/digi-green-hackathon


### Garage48 / deep / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/0
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Garage48 15-Year Anniversary Hackathon - https://garage48.org/events/g48anniversaryhack15
2. Tech for Agriculture Kenya Edition - https://garage48.org/events/techforagriculturekenya
3. Hack the Border - https://garage48.org/events/hack-the-border
4. Empowering Women Idea Garage - https://garage48.org/events/empowering-women-eesti-ettevotlusprogramm
5. Empowering Women: Digitalisation and Export Acceleration 2025 - https://garage48.org/events/empowering-women-digitalisation-and-export-acceleration-2025
6. Female Founders Academy - https://garage48.org/events/femalefoundersacademynairobi
7. Klavani Jalkahäkk - https://garage48.org/events/klavani-jalkahakk-1
8. Hack the Future - https://garage48.org/events/hack-the-future
9. Minu Lääne-Virumaa Hackathon - https://garage48.org/events/minu-laane-viru-hackathon
10. Empowering Women Ettevõtlusprogramm - https://garage48.org/events/empowering-women-ettevotlusprogramm
11. Häkaton Andmetorm 2024 - https://garage48.org/events/andmetorm
12. EdTech Hackathon in Armenia - https://garage48.org/events/edtech-armenia
13. Green Growth AgriHack - https://garage48.org/events/greengrowth-agrihack
14. Empowering Women Mentorite Meistriklass - https://garage48.org/events/empowering-women-mentorite-meistriklass
15. Empowering Women Idee Garage - https://garage48.org/events/empowering-women-idee-garage
16. Empowering Women: Digitalisation and Export Acceleration - https://garage48.org/events/empowering-women
17. Ecotech Hackathon- Making Urban Water Smart - https://garage48.org/events/ecotechhackathon
18. #OceanHack4EU - https://garage48.org/events/oceanhack4eu
19. Empowering Women Ukraine 2024 ACCELERATION: Entrepreneurship programme for business development - https://garage48.org/events/empowering-women-ukraine-2024-acceleration-entrepreneurship-programme-for-business-development
20. DIGI-GREEN HACKATHON - https://garage48.org/events/digi-green-hackathon


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
Quality: usable_partial
Estimated recall: 83%
Precision estimate: 100%

Lead sample for manual precision review:

1. MunichTech EXPO
2. Casper Network
3. WEEX LABs
4. WEEX LABs
5. Tether
6. WEEX LABs
7. iExec
8. KeeperHub
9. Flare
10. Ethereum Uruguay
11. Algorand
12. Blockchain Legal Institute
13. TechHub Africa LLC
14. Blockchain Legal Institute
15. HackTrent
16. SATNAV AFRICA JPO
17. HackOnVibe_com
18. HashKey Chain
19. Terminal 3
20. Casper Network


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
Quality: usable_partial
Estimated recall: 83%
Precision estimate: 100%

Lead sample for manual precision review:

1. MunichTech EXPO
2. Casper Network
3. WEEX LABs
4. WEEX LABs
5. Tether
6. WEEX LABs
7. iExec
8. KeeperHub
9. Flare
10. Ethereum Uruguay
11. Algorand
12. Blockchain Legal Institute
13. TechHub Africa LLC
14. Blockchain Legal Institute
15. HackTrent
16. SATNAV AFRICA JPO
17. HackOnVibe_com
18. HashKey Chain
19. Terminal 3
20. Casper Network


### hackathons.space / standard / custom

Runtime: custom
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: failed
Estimated recall: 0%
Precision estimate: 0%

Lead sample for manual precision review:

No leads extracted.

### hackathons.space / standard / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_growth
Pagination executed: yes
Browser escalated: yes
Actions: 1/5
Quality: failed
Estimated recall: 0%
Precision estimate: 0%

Lead sample for manual precision review:

No leads extracted.

### hackathons.space / deep / custom

Runtime: custom
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: failed
Estimated recall: 0%
Precision estimate: 0%

Lead sample for manual precision review:

No leads extracted.

### hackathons.space / deep / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_growth
Pagination executed: yes
Browser escalated: yes
Actions: 1/5
Quality: failed
Estimated recall: 0%
Precision estimate: 0%

Lead sample for manual precision review:

No leads extracted.

### Eventornado / standard / custom

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

### Eventornado / standard / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/1
Quality: failed
Estimated recall: 0%
Precision estimate: 0%

Lead sample for manual precision review:

No leads extracted.

### Eventornado / deep / custom

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

### Eventornado / deep / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/1
Quality: failed
Estimated recall: 0%
Precision estimate: 0%

Lead sample for manual precision review:

No leads extracted.
