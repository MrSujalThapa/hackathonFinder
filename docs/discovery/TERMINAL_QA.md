# Terminal QA (Phase 11)

Captured on 2026-07-13 on branch `step-11-terminal-and-source-reliability`.

## Setup

| Item | Actual |
|---|---|
| Base URL | `http://localhost:3100` |
| Capture script | `scripts/terminal-final-qa-capture.ts` |
| Viewports | `390x844`, `430x932`, `768x1024`, `1024x900`, `1440x1000`, `1728x900` |
| Candidate/search/LLM mode | mock/local |
| Discovery job store | `memory` |
| Terminal session store | `memory` |
| Storage capability | `{ mode: "memory", durable: false, migrationReady: false }` |
| Hakku connect | `TERMINAL_SOURCE_MOCK_HAKKU=true` browser-QA path |
| Migration 007 | Not applied |
| X | Not tested, not called |

Re-run shape:

```powershell
$env:USE_MOCK_CANDIDATES="true"
$env:DISCOVERY_JOB_STORE="memory"
$env:TERMINAL_SESSION_STORE="memory"
$env:TERMINAL_SOURCE_MOCK_HAKKU="true"
$env:SEARCH_PROVIDER="mock"
$env:LLM_PROVIDER="mock"
npm.cmd run dev -- -p 3100

$env:SMOKE_BASE_URL="http://localhost:3100"
$env:SMOKE_OWNER_PASSWORD="<qa owner password>"
npm.cmd exec -- tsx scripts/terminal-final-qa-capture.ts
```

## Results

| Scenario | Expected | Actual | Result | Screenshots |
|---|---|---|---|---|
| Navigation persistence | Return to Terminal restores linked job output with no duplicate event lines. | Job restored, command visible, duplicate line count `0`. | PASS | `artifacts/terminal/final-persistence/navigation-return__*.png` |
| Refresh persistence | Refresh restores terminal tab and replays historical job events. | Job restored, command visible, duplicate line count `0`. | PASS | `artifacts/terminal/final-persistence/refresh-restore__*.png` |
| Multiple terminals | Three named sessions restore separately with isolated output and selected jobs. | Four open sessions total including the original; AI Canada, Robotics, and Remote Students restored with isolated output. | PASS | `artifacts/terminal/final-multi-session/three-sessions-restored__*.png` |
| Terminal close | Closing a terminal keeps its job discoverable via `/jobs`. | Closed session's job remained listed. | PASS | `artifacts/terminal/final-multi-session/close-keeps-job__*.png` |
| Source + command UX | Hakku status/check/connect/disconnect confirmation, shell rejection, autocomplete, and history work without secret leakage. | Mocked Hakku connect emitted safe connected/disconnected flow; shell command rejected; Tab completed `/sou` to `/sources`; ArrowUp recalled `/help`. | PASS | `artifacts/terminal/final-source-connect/source-connect-commands__*.png` |
| Mobile terminal | Session selector, readable input, no horizontal overflow, touch-sized input. | `overflowX=false`, input height `40`, mobile selector present. | PASS | `artifacts/terminal/final-source-connect/mobile-command-ux__*.png` |

Machine-readable reports were written to:

- `artifacts/terminal/final-persistence/qa-report.json`
- `artifacts/terminal/final-multi-session/qa-report.json`
- `artifacts/terminal/final-source-connect/qa-report.json`

## Known Limitations

- Migration `007_terminal_sessions.sql` was not applied, so this is not database-durable proof.
- Memory mode validates refresh/navigation within one running Next.js process only.
- Restarting the Next.js process still interrupts local in-process jobs; worker mode remains the deployment path.
- Hakku connect used the development-only mock path; live manual Hakku login is still a next-phase acceptance item.
- Dry-run mock jobs complete quickly, so browser QA supplements, but does not replace, the automated concurrency and Hakku lock tests.
- Dev-mode captures include expected Fast Refresh / hydration noise; no secret-like values were reported in terminal output.
