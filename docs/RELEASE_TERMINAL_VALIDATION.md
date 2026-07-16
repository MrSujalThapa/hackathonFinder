# Release Terminal validation notes

Local artifacts from authenticated Terminal runs live under gitignored
`.local-audits/release-terminal/` (screenshots + text captures). They are not
committed.

Validation driver: `scripts/release-terminal-validation.ts` (Playwright against
the real `/terminal` page; waits on discovery job completion via API).

## Demo mode

Final validation runs with `DEMO_MODE=false` and `USE_MOCK_CANDIDATES=false`.
The Terminal page must not show the demo/mock banner.

## Scenario outcomes (2026-07-16)

| ID | Command | Result | Notes |
| --- | --- | --- | --- |
| A | Toronto light dry-run | PASS | Location Toronto; remote excluded; dry-run; no writes |
| B | Toronto or remote AI light dry-run | PASS | Remote included; 6-month window; dry-run |
| C | San Francisco light dry-run | PASS | SF constraint; dry-run |
| D | SF or remote standard dry-run | PASS | Remote included; dry-run |
| E | 2026-08-01..2026-10-31 standard dry-run | PASS | Explicit dates parsed |
| F | next 3 months standard dry-run | PASS | No city forced in query interpretation |
| G | Canada eligibility deep dry-run | PASS | Eligibility framing; dry-run |
| H | Devpost deep dry-run | PASS | Sources=devpost; `full_directory_api`; **500** listing cards (cap); listing before detail |
| I | Luma deep dry-run | PASS | Sources=luma; **50** unique (live inventory/timeouts below 100 target) |
| J | Reskilll deep dry-run | PASS | `custom:reskilll` only; DirectoryCrawlKernel; 100/161 leads; no V1 |
| K space | hackathons.space light dry-run | PASS* | Kernel ran; **0** leads this run (live parity risk vs ~30) |
| K taikai | Taikai light dry-run | PASS* | Kernel; **23/29** leads (below historical ~40) |
| K eventornado | Eventornado light dry-run | PASS | Honestly partial (2/4) |
| K dorahacks | DoraHacks light dry-run | PASS | Blocked human verification; 0 leads; no bypass |
| P | Toronto light write | PASS | Batch persistence; created=0 updated=3; dry-run=no; no Sheets |
| P rerun | identical write | PASS | created=0 updated=3 |
| Cancel | deep dry-run then `/cancel` | PASS | Cancellation requested |

\* Live source inventory variance — not treated as a packaging code defect.

## Known live-source risks

- Tavily HTTP 432 degrades web search honestly; other sources continue
- Luma deep may finish under the 100-unique aspirational bar when feeds stall
- Custom directories (hackathons.space / Taikai) vary with upstream HTML
- Reskilll can extract many listing cards while post-filter would-create is 0
  when registration/date constraints reject queue-ready status
