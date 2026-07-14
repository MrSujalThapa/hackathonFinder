# Phase 5.2 Crawlee Runtime Comparison

Date: 2026-07-14T23:40:26.854Z
Persistence: disabled

## Matrix

| Site | Profile | Runtime | Quality | Pages | Records observed | Valid events | Estimated available | Estimated recall | Precision | Duplicate rate | Duration s | Stop reason |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Devfolio | quick | custom | healthy_complete | 1 | 30 | 20 | 20 | 100% | 100% | 0% | 2.0 | no_page_param |
| Devfolio | quick | crawlee | healthy_complete | 1 | 30 | 20 | 20 | 100% | 100% | 0% | 3.1 | no_page_param |
| Devpost | quick | custom | degraded_under_extraction | 1 | 82 | 8 | 13591 | 0% | 100% | 0% | 4.8 | page_cap |
| Devpost | quick | crawlee | degraded_under_extraction | 1 | 82 | 8 | 13591 | 0% | 100% | 0% | 7.7 | no_page_param |
| MLH | quick | custom | healthy_complete | 2 | 124 | 63 | 63 | 100% | 100% | 0% | 3.6 | fetch_failed |
| MLH | quick | crawlee | healthy_complete | 1 | 124 | 63 | 63 | 100% | 100% | 0% | 3.1 | no_page_param |
| Hackathon Radar | quick | custom | degraded_under_extraction | 1 | 36 | 3 | 100 | 3% | 100% | 0% | 0.7 | page_cap |
| Hackathon Radar | quick | crawlee | degraded_under_extraction | 1 | 36 | 3 | 100 | 3% | 100% | 0% | 1.8 | request_cap |
| Hackathon Map | quick | custom | healthy_complete | 1 | 0 | 3 | 3 | 100% | 100% | 0% | 7.2 | no_page_param |
| Hackathon Map | quick | crawlee | healthy_complete | 1 | 0 | 3 | 3 | 100% | 100% | 0% | 11.3 | no_page_param |
| Hack Club | quick | custom | degraded_under_extraction | 2 | 115 | 2 | 888 | 0% | 100% | 0% | 9.6 | fetch_failed |
| Hack Club | quick | crawlee | degraded_under_extraction | 1 | 115 | 2 | 888 | 0% | 100% | 0% | 11.6 | no_page_param |
| Garage48 | quick | custom | healthy_complete | 1 | 0 | 194 | 194 | 100% | 100% | 0% | 5.0 | no_page_param |
| Garage48 | quick | crawlee | healthy_complete | 1 | 0 | 194 | 194 | 100% | 100% | 0% | 8.6 | no_page_param |
| Unstop | quick | custom | degraded_under_extraction | 1 | 947 | 10 | 768 | 1% | 100% | 0% | 8.1 | page_cap |
| Unstop | quick | crawlee | degraded_under_extraction | 1 | 947 | 10 | 768 | 1% | 100% | 0% | 9.7 | no_page_param |
| Eventbrite | quick | custom | degraded_under_extraction | 2 | 158 | 4 | 106 | 4% | 100% | 0% | 3.7 | fetch_failed |
| Eventbrite | quick | crawlee | degraded_under_extraction | 1 | 158 | 4 | 106 | 4% | 100% | 0% | 2.5 | no_page_param |
| TAIKAI | quick | custom | degraded_under_extraction | 2 | 373 | 2 | 40 | 5% | 100% | 0% | 1.6 | fetch_failed |
| TAIKAI | quick | crawlee | degraded_under_extraction | 1 | 373 | 2 | 40 | 5% | 100% | 0% | 2.2 | no_page_param |
| DoraHacks | quick | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 6.9 | unknown |
| DoraHacks | quick | crawlee | degraded_under_extraction | 1 | 104 | 2 | 24 | 8% | 100% | 0% | 13.3 | no_page_param |
| hackathons.space | quick | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 7.3 | no_page_param |
| hackathons.space | quick | crawlee | failed | 2 | 0 | 0 | unknown | 0% | 0% | 0% | 15.5 | no_growth |
| Eventornado | quick | custom | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 3.8 | unknown |
| Eventornado | quick | crawlee | failed | 1 | 0 | 0 | unknown | 0% | 0% | 0% | 6.9 | no_page_param |
| HackerEarth | quick | custom | healthy_complete | 2 | 6 | 8 | 8 | 100% | 100% | 0% | 7.5 | fetch_failed |
| HackerEarth | quick | crawlee | healthy_complete | 3 | 14 | 8 | 8 | 100% | 100% | 0% | 11.0 | page_cap |
| Open Hackathons | quick | custom | error | 0 | 0 | 0 | unknown | unknown | 0% | 0% | 0.0 | fetch failed |
| Open Hackathons | quick | crawlee | degraded_under_extraction | 1 | 2580 | 5 | 1415 | 0% | 100% | 0% | 11.5 | no_page_param |
| AngelHack | quick | custom | healthy_complete | 1 | 4 | 2 | 2 | 100% | 100% | 0% | 3.4 | no_page_param |
| AngelHack | quick | crawlee | healthy_complete | 1 | 4 | 2 | 2 | 100% | 100% | 0% | 9.5 | no_growth |

## Held-Out Sites

- HackerEarth: https://www.hackerearth.com/challenges/hackathon/
- Open Hackathons: https://www.openhackathons.org/s/upcoming-events
- AngelHack: https://angelhack.com/events/

## Precision Samples

### Devfolio / quick / custom

Runtime: custom
Mode: static
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Build with Gemma - https://devfolio.co/build-with-gemma-bengaluru-ai-sprint
2. HackVSIT7.0 - https://devfolio.co/hackvsit-7
3. FutureForge Hackathon 2026 - https://devfolio.co/futureforge-hackathon
4. HyperFusion - https://devfolio.co/hyperfusion
5. PEC HACKS 4.0 - https://devfolio.co/pec-hacks
6. Push to Prod Hackathon: Building at the Frontier - https://devfolio.co/pushtoprod-india
7. Agentic Commerce Hackathon - https://devfolio.co/agentic-commerce
8. Ignisys 1.O - https://devfolio.co/ignisys-ignitia
9. CodeStorm 2026 #2 - https://devfolio.co/codestorm-week2-2026
10. Port Mortem 2026 - Code Resurrection Hackathon - https://devfolio.co/portmortem
11. NexHack 2.0 - https://devfolio.co/nexhack-2
12. .hack '26 - https://devfolio.co/dothack26
13. DSU DEVHACK 3.0 - https://devfolio.co/dsudevhack3
14. Dora Hack 2.0 - https://devfolio.co/dora-hack
15. Brainwave 2026 - https://devfolio.co/brain-wave
16. ETHKochi - https://devfolio.co/ethkochi
17. HackNex Season 2 - https://devfolio.co/hacknex-season-2
18. MUBA Blockchain Hackathon - https://devfolio.co/muba-hackathon
19. CodeStorm 2026: FutureForge - https://devfolio.co/codestorm-futureforge
20. HACKER HOUSE GOA 2026 - https://devfolio.co/hacker-house-goa-2026


### Devfolio / quick / crawlee

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

1. Build with Gemma - https://devfolio.co/build-with-gemma-bengaluru-ai-sprint
2. HackVSIT7.0 - https://devfolio.co/hackvsit-7
3. FutureForge Hackathon 2026 - https://devfolio.co/futureforge-hackathon
4. HyperFusion - https://devfolio.co/hyperfusion
5. PEC HACKS 4.0 - https://devfolio.co/pec-hacks
6. Push to Prod Hackathon: Building at the Frontier - https://devfolio.co/pushtoprod-india
7. Agentic Commerce Hackathon - https://devfolio.co/agentic-commerce
8. Ignisys 1.O - https://devfolio.co/ignisys-ignitia
9. CodeStorm 2026 #2 - https://devfolio.co/codestorm-week2-2026
10. Port Mortem 2026 - Code Resurrection Hackathon - https://devfolio.co/portmortem
11. NexHack 2.0 - https://devfolio.co/nexhack-2
12. .hack '26 - https://devfolio.co/dothack26
13. DSU DEVHACK 3.0 - https://devfolio.co/dsudevhack3
14. Dora Hack 2.0 - https://devfolio.co/dora-hack
15. Brainwave 2026 - https://devfolio.co/brain-wave
16. ETHKochi - https://devfolio.co/ethkochi
17. HackNex Season 2 - https://devfolio.co/hacknex-season-2
18. MUBA Blockchain Hackathon - https://devfolio.co/muba-hackathon
19. CodeStorm 2026: FutureForge - https://devfolio.co/codestorm-futureforge
20. HACKER HOUSE GOA 2026 - https://devfolio.co/hacker-house-goa-2026


### Devpost / quick / custom

Runtime: custom
Mode: browser
Stop reason: page_cap
Pagination executed: no
Browser escalated: no
Actions: 0/0
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


### Devpost / quick / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/0
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


### MLH / quick / custom

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


### MLH / quick / crawlee

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


### Hackathon Radar / quick / custom

Runtime: custom
Mode: static
Stop reason: page_cap
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


### Hackathon Radar / quick / crawlee

Runtime: crawlee
Mode: static
Stop reason: request_cap
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


### Hackathon Map / quick / custom

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

1. Global Hack Week: Season Launch - https://events.mlh.io/events/14284-global-hack-week-season-launch
2. Global Hack Week: Agents - https://events.mlh.io/events/14312-global-hack-week-agents
3. Global Hack Week: Data - https://events.mlh.io/events/14416-global-hack-week-data


### Hackathon Map / quick / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/1
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Global Hack Week: Season Launch - https://events.mlh.io/events/14284-global-hack-week-season-launch
2. Global Hack Week: Agents - https://events.mlh.io/events/14312-global-hack-week-agents
3. Global Hack Week: Data - https://events.mlh.io/events/14416-global-hack-week-data


### Hack Club / quick / custom

Runtime: custom
Mode: browser
Stop reason: fetch_failed
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 0%
Precision estimate: 100%

Lead sample for manual precision review:

1. Maintained by , a nonprofit network of 20k+ high school hackers & coding clubs around the world. - https://hackclub.com/
2. Want to run your own hackathon? Get started . - https://hackclub.com/hackathons/


### Hack Club / quick / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/1
Quality: degraded_under_extraction
Estimated recall: 0%
Precision estimate: 100%

Lead sample for manual precision review:

1. Maintained by , a nonprofit network of 20k+ high school hackers & coding clubs around the world. - https://hackclub.com/
2. Want to run your own hackathon? Get started . - https://hackclub.com/hackathons/


### Garage48 / quick / custom

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


### Garage48 / quick / crawlee

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


### Unstop / quick / custom

Runtime: custom
Mode: browser
Stop reason: page_cap
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 1%
Precision estimate: 100%

Lead sample for manual precision review:

1. Placement Reports - https://unstop.com/placement-reports
2. College Diaries - https://unstop.com/college-diaries
3. Campus Life - https://unstop.com/campus-life
4. Campus Must-haves - https://unstop.com/campus-must-have
5. College Alumni - https://unstop.com/college-alumni
6. College Fest - https://unstop.com/college-fest
7. Competitions - https://unstop.com/competitions
8. Courses - https://unstop.com/courses
9. College Life - https://unstop.com/college-life
10. Collegiate Must Reads - https://unstop.com/collegiate-must-reads


### Unstop / quick / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 1%
Precision estimate: 100%

Lead sample for manual precision review:

1. Placement Reports - https://unstop.com/placement-reports
2. College Diaries - https://unstop.com/college-diaries
3. Campus Life - https://unstop.com/campus-life
4. Campus Must-haves - https://unstop.com/campus-must-have
5. College Alumni - https://unstop.com/college-alumni
6. College Fest - https://unstop.com/college-fest
7. Competitions - https://unstop.com/competitions
8. Courses - https://unstop.com/courses
9. College Life - https://unstop.com/college-life
10. Collegiate Must Reads - https://unstop.com/collegiate-must-reads


### Eventbrite / quick / custom

Runtime: custom
Mode: static
Stop reason: fetch_failed
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 4%
Precision estimate: 100%

Lead sample for manual precision review:

1. Use Eventbrite - https://www.eventbrite.com/organizer/overview/
2. Plan Events - https://www.eventbrite.com/organizer/features/sell-tickets/
3. Find Events - https://www.eventbrite.com/b/la--new-orleans/food-and-drink/
4. Connect With UsContact SupportContact SalesXFacebookLinkedInInstagramTikTok - https://www.eventbrite.com/help/en-us/contact-us/


### Eventbrite / quick / crawlee

Runtime: crawlee
Mode: static
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 4%
Precision estimate: 100%

Lead sample for manual precision review:

1. Use Eventbrite - https://www.eventbrite.com/organizer/overview/
2. Plan Events - https://www.eventbrite.com/organizer/features/sell-tickets/
3. Find Events - https://www.eventbrite.com/b/la--new-orleans/food-and-drink/
4. Connect With UsContact SupportContact SalesXFacebookLinkedInInstagramTikTok - https://www.eventbrite.com/help/en-us/contact-us/


### TAIKAI / quick / custom

Runtime: custom
Mode: static
Stop reason: fetch_failed
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 5%
Precision estimate: 100%

Lead sample for manual precision review:

1. Hackathons
2. Blog - https://taikai.network/en/blog


### TAIKAI / quick / crawlee

Runtime: crawlee
Mode: static
Stop reason: no_page_param
Pagination executed: no
Browser escalated: no
Actions: 0/0
Quality: degraded_under_extraction
Estimated recall: 5%
Precision estimate: 100%

Lead sample for manual precision review:

1. Hackathons
2. Blog - https://taikai.network/en/blog


### DoraHacks / quick / custom

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

### DoraHacks / quick / crawlee

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


### hackathons.space / quick / custom

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

### hackathons.space / quick / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_growth
Pagination executed: yes
Browser escalated: yes
Actions: 1/4
Quality: failed
Estimated recall: 0%
Precision estimate: 0%

Lead sample for manual precision review:

No leads extracted.

### Eventornado / quick / custom

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

### Eventornado / quick / crawlee

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

### HackerEarth / quick / custom

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

1. ScriptedBy{Her} 2.0 Jun 8, 2026 UTC (UTC) Prizes 36275 - https://www.hackerearth.com/challenges/hackathon/scriptedbyher-2026/
2. Hiring Radar May 27, 2026 UTC (UTC) Prizes - https://www.hackerearth.com/challenges/hackathon/hiring-radar/
3. Microsoft Build AI May 5, 2026 UTC (UTC) Prizes - https://www.hackerearth.com/challenges/hackathon/microsoft-build-ai-2027/
4. BEAT THE HEAT Challenge Apr 27, 2026 UTC (UTC) Prizes 43 - https://www.hackerearth.com/challenges/hackathon/beat-the-heat-challenge/
5. TinyFish $2M Pre-Accelerator Hackathon Feb 25, 2026 UTC (UTC) Prizes 4314 - https://www.hackerearth.com/challenges/hackathon/the-tiny-fish-hackathon-2026/
6. The Big Code Feb 20, 2026 UTC (UTC) Prizes - https://www.hackerearth.com/challenges/hackathon/the-big-code/
7. Zerve.AI 2026 Hackathon Jan 21, 2026 UTC (UTC) Prizes - https://www.hackerearth.com/challenges/hackathon/zerve-ai-2026-hackathon/
8. Elastic Blogathon 2026 Jan 12, 2026 UTC (UTC) Prizes - https://www.hackerearth.com/challenges/hackathon/elastic-blogathon-2026/


### HackerEarth / quick / crawlee

Runtime: crawlee
Mode: static
Stop reason: page_cap
Pagination executed: yes
Browser escalated: no
Actions: 0/0
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. ScriptedBy{Her} 2.0 Jun 8, 2026 UTC (UTC) Prizes 36275 - https://www.hackerearth.com/challenges/hackathon/scriptedbyher-2026/
2. Hiring Radar May 27, 2026 UTC (UTC) Prizes - https://www.hackerearth.com/challenges/hackathon/hiring-radar/
3. Microsoft Build AI May 5, 2026 UTC (UTC) Prizes - https://www.hackerearth.com/challenges/hackathon/microsoft-build-ai-2027/
4. BEAT THE HEAT Challenge Apr 27, 2026 UTC (UTC) Prizes 43 - https://www.hackerearth.com/challenges/hackathon/beat-the-heat-challenge/
5. TinyFish $2M Pre-Accelerator Hackathon Feb 25, 2026 UTC (UTC) Prizes 4314 - https://www.hackerearth.com/challenges/hackathon/the-tiny-fish-hackathon-2026/
6. The Big Code Feb 20, 2026 UTC (UTC) Prizes - https://www.hackerearth.com/challenges/hackathon/the-big-code/
7. Zerve.AI 2026 Hackathon Jan 21, 2026 UTC (UTC) Prizes - https://www.hackerearth.com/challenges/hackathon/zerve-ai-2026-hackathon/
8. Elastic Blogathon 2026 Jan 12, 2026 UTC (UTC) Prizes - https://www.hackerearth.com/challenges/hackathon/elastic-blogathon-2026/


### Open Hackathons / quick / custom

Error: fetch failed

### Open Hackathons / quick / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_page_param
Pagination executed: no
Browser escalated: yes
Actions: 0/1
Quality: degraded_under_extraction
Estimated recall: 0%
Precision estimate: 100%

Lead sample for manual precision review:

1. India Agentic AI Open Hackathon Dates: June 26, 2026 - July 25, 2026Event Focus:AIEvent Format:In-Person EventRegion:Asia-Pacific Application Status: Closed - https://www.openhackathons.org/s/siteevent/a0CUP00004gn7e32AA
2. Open Models AI Codefest Dates: July 3-31, 2026Event Focus:AIEvent Format:Virtual EventRegion:Asia-Pacific Application Status: Closed - https://www.openhackathons.org/s/siteevent/a0CUP00004wePOT2A2
3. NERSC Open Hackathon Dates: August 18-28, 2026Event Focus:AI+HPCEvent Format:Hybrid EventRegion:North America/Latin America Application Status: Closed - https://www.openhackathons.org/s/siteevent/a0CUP00002xLFtf2AG
4. Helmholtz GPU Hackathon Dates: September 2-11, 2026Event Focus:AI+HPCEvent Format:Hybrid EventRegion:Europe/Middle East/Africa Application Status: Closed - https://www.openhackathons.org/s/siteevent/a0CUP00003Wjr4Y2AR
5. NCSA/PSC Open Hackathon Dates: September 8-17, 2026Event Focus:AI+HPCEvent Format:Virtual EventRegion:North America/Latin America Application Status: Closed - https://www.openhackathons.org/s/siteevent/a0CUP00003Q8yvG2AR


### AngelHack / quick / custom

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

1. Solutions Developer Relations Developer Marketing Web3 Ecosystem Growth Innovation Talent Acquisition - https://angelhack.com/services/hackathon/
2. Discord X-twitter Linkedin Instagram Youtube Facebook - https://angelhack.com/terms-of-service/


### AngelHack / quick / crawlee

Runtime: crawlee
Mode: browser
Stop reason: no_growth
Pagination executed: yes
Browser escalated: yes
Actions: 1/1
Quality: healthy_complete
Estimated recall: 100%
Precision estimate: 100%

Lead sample for manual precision review:

1. Solutions Developer Relations Developer Marketing Web3 Ecosystem Growth Innovation Talent Acquisition - https://angelhack.com/services/hackathon/
2. Discord X-twitter Linkedin Instagram Youtube Facebook - https://angelhack.com/terms-of-service/

