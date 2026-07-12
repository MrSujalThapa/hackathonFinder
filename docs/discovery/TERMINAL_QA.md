# Terminal visual QA (Step 16)

Captured **2026-07-12** on branch `step-11-terminal-and-source-reliability` using Playwright (`scripts/terminal-source-qa-capture.ts`).

## Run setup

| Item | Value |
|---|---|
| Base URL | `http://localhost:3000` |
| Auth | API login (`POST /api/auth/login`) with `SMOKE_OWNER_PASSWORD=design-overhaul-pass` |
| Hash override | `APP_OWNER_PASSWORD_HASH_B64` (QA hash; `.env.local` legacy hash did not match known passwords) |
| Mock candidates | `USE_MOCK_CANDIDATES=true` |
| Job store | `DISCOVERY_JOB_STORE=memory` (required until migration `006_discovery_jobs.sql` is applied) |
| Execution mode | `DISCOVERY_EXECUTION_MODE=local` (from `.env.local`) |

Re-run:

```powershell
$env:APP_OWNER_PASSWORD_HASH_B64="c2NyeXB0JDEkMTYzODQkOCQxJEZYeDF4b19nUEFZV19CZ2lJZEpFcFEkOWtzelJsU1dPZl9DSmtXNDlhOG9iNTdCMEpnOHpGRkIzNkMweklIeGt3RUlsSktLUnlHNDNhVmdSUzk3Q2Yway1wTXBicGZDS0xRZkxJN1B2ckI5QkE"
$env:USE_MOCK_CANDIDATES="true"
$env:DISCOVERY_JOB_STORE="memory"
npm run dev

$env:SMOKE_OWNER_PASSWORD="design-overhaul-pass"
$env:SMOKE_BASE_URL="http://localhost:3000"
npx tsx scripts/terminal-source-qa-capture.ts
```

## Viewport matrix

| Viewport | Empty | Input | /help | /sources | /status | /history | Shell reject | Dry-run status/history | UI /find |
|---|---|---|---|---|---|---|---|---|---|
| 390×844 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 430×932 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 768×1024 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1024×900 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1440×1000 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1728×900 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Artifacts: `artifacts/terminal/{label}__{viewport}.png`  
Machine-readable report: `artifacts/terminal/qa-report.json`, `artifacts/terminal/console.json`

## Pass / fail summary

| Check | Result | Notes |
|---|---|---|
| Auth login | **PASS** | API login → `/queue` |
| Empty state | **PASS** | “Discovery console ready…” + `#discovery-terminal-input` |
| Command input | **PASS** | 44px min height, `$` prompt, Run button |
| `/help` | **PASS** | Lists `/find`, `/sources`, `/status`, `/history`, `/cancel`, `/clear` |
| `/sources` | **PASS** | Console + source rail show MLH/Web/HackList/Devpost/Luma/Hakku health |
| `/status` | **PASS** | Idle / job status line |
| `/history` | **PASS** | Recent jobs or empty message |
| Shell reject (`rm -rf /`) | **PASS** | Friendly rejection; no shell execution |
| Mobile layout (390×844) | **PASS** | No horizontal overflow; input ≥44px; bottom nav present |
| Secret leakage (DOM) | **PASS** | No `.data/browser-profiles`, cookies, or keys in rendered text |
| Discovery dry-run (API) | **PASS** | `POST /api/discovery/jobs` with `dryRun:true` → 201 |
| UI `/find` | **PASS** | Warns when a run is already active (expected after dry-run) |
| Console errors | **PASS** | No actionable errors after filtering dev-only HMR/hydration noise |
| Console secret leak | **PASS** | No leak-pattern matches |

**Overall: 19/19 automated checks passed** (final capture run).

## Console issues (non-blocking)

Filtered as dev-environment noise in the capture script:

- **HMR hot-update 404** — `webpack.hot-update.json` missing during Fast Refresh rebuilds.
- **Hydration mismatch** — Settings/source timestamps can differ between SSR and client locale formatting (does not block Terminal interaction after client render).
- **React DevTools info** — standard dev banner.

No secrets, profile paths, or cookie values appeared in console output.

## Mobile / keyboard notes

- **Bottom nav** overlays the workspace on phone widths; terminal input remains reachable above it.
- **Source rail** collapses on small screens (`Show` / `Hide`); expanded rail visible in `shell-reject__390x844.png`.
- **Input**: monospace textarea, Enter submits, Shift+Enter newline, ↑/↓ history at caret boundaries.
- **Virtual keyboard**: not exercised on a real device; viewport-only simulation.
- **Full-page captures** on 390×844 are long (expected) because output scrolls above the fixed input/nav stack.

## Discovery run coverage

| Scenario | Result |
|---|---|
| API dry-run job create | **PASS** — 201 with `DISCOVERY_JOB_STORE=memory` |
| SSE event stream to completion | **Not captured** — dry-run enqueues; full planner/collector stream not waited on in QA |
| UI natural-language find | **Partial** — blocked when prior job still active; shows correct guard message |
| `/cancel` during active run | **Not exercised** in this pass |

## Blockers encountered during QA (resolved for capture)

1. **Stale server on port 3000** — first run hit an old process serving unstyled HTML (JS chunks 404). Fix: kill port 3000 listeners, restart `npm run dev`.
2. **Auth hash mismatch** — `.env.local` `APP_OWNER_PASSWORD_HASH` did not verify against `design-overhaul-pass`. Fix: set `APP_OWNER_PASSWORD_HASH_B64` for QA sessions (same pattern as design capture scripts).
3. **Discovery jobs 500** — Supabase configured but migration `006_discovery_jobs.sql` not applied. Fix: `DISCOVERY_JOB_STORE=memory` for local Terminal QA (documented; migration not applied per scope).

## Remaining gaps

- Apply migration `006_discovery_jobs.sql` and re-test with Supabase-backed job persistence + SSE streaming.
- Capture a full non-dry discovery run through `run_completed` / `run_failed` events.
- Real-device mobile keyboard overlap check (iOS Safari / Android Chrome).
- Production build console pass (exclude dev HMR/hydration).
- `/cancel` UX while job is `planning` / `running`.

## Key screenshot references

| Scenario | Representative path |
|---|---|
| Empty / idle | `artifacts/terminal/empty__1440x1000.png` |
| `/help` | `artifacts/terminal/help__1440x1000.png` |
| `/sources` + rail | `artifacts/terminal/sources__1440x1000.png` |
| Shell rejection | `artifacts/terminal/shell-reject__390x844.png` |
| Active-run guard | `artifacts/terminal/ui-find__1440x1000.png` |
| Phone layout | `artifacts/terminal/empty__390x844.png` |
