# Settings Sources panel QA (Step 16)

Captured **2026-07-12** alongside Terminal QA via `scripts/terminal-source-qa-capture.ts`.

## Run setup

Same server/auth env as [TERMINAL_QA.md](./TERMINAL_QA.md):

- `http://localhost:3000`
- `SMOKE_OWNER_PASSWORD=design-overhaul-pass`
- `USE_MOCK_CANDIDATES=true`
- `DISCOVERY_JOB_STORE=memory`

Route: `/settings` → **Sources** section (`SourcesPanel`).

## Viewport matrix

| Viewport | Full panel | Luma card focus | Hakku card focus |
|---|---|---|---|
| 390×844 | ✓ (`settings-sources__390x844.png`) | ✓ (`luma-card-phone__390x844.png`) | ✓ (`hakku-card-phone__390x844.png`) |
| 430×932 | ✓ | — | — |
| 768×1024 | ✓ | — | — |
| 1024×900 | ✓ | — | — |
| 1440×1000 | ✓ (`settings-sources__1440x1000.png`) | ✓ (`luma-card-laptop__1440x1000.png`) | ✓ (`hakku-card-laptop__1440x1000.png`) |
| 1728×900 | ✓ | — | — |

Artifacts: `artifacts/sources/`  
Report: `artifacts/sources/qa-report.json`, `artifacts/sources/console.json`

## Pass / fail summary

| Check | Result | Notes |
|---|---|---|
| All six source cards | **PASS** | MLH, Web, HackList, Devpost, Luma, Hakku |
| Status display | **PASS** | Colored status labels on each card |
| Hakku connect instructions | **PASS** | `npm run source:connect -- hakku`; no profile paths shown |
| Luma public mode | **PASS** | “Public mode is supported…” copy present |
| Secret leakage | **PASS** | No browser profile paths or cookies in DOM |
| Console secret leak | **PASS** | No leak-pattern console text |

**Overall: 5/5 Sources-specific checks passed.**

## Observed source health (local snapshot)

Health reflects cached snapshots + panel load time; live **Check** buttons were not clicked during capture.

| Source | Status | Mode / notes |
|---|---|---|
| **MLH** | healthy | Public discovery; 5 leads accepted |
| **Web** | degraded | “Web search stopped early after timeout budget” |
| **HackList** | healthy | Public discovery; 5 leads accepted |
| **Devpost** | degraded | `browser missing` / Playwright selector failure locally |
| **Luma** | healthy | Public mode; connected mode unavailable (expected) |
| **Hakku** | auth required | Profile not connected; setup instructions only (no live login) |

Terminal `/sources` output matched Settings cards (see `artifacts/terminal/sources__1440x1000.png`).

## Hakku panel

- Status: **AUTH REQUIRED** / needs setup / browser required / not connected.
- Copy: `npm run source:connect -- hakku`
- Explicit: “Profile paths and cookies are never shown here.”
- **Not tested**: live browser connect or authenticated discovery (out of scope).

## Luma panel

- Status: **healthy** (public discovery).
- Copy: “Public mode is supported. Connected mode is unavailable / not connected in this phase.”
- Matches `docs/discovery/LUMA_MODES.md` public-only phase.

## Console issues

Same dev-only noise as Terminal QA (HMR 404, optional hydration warnings on Settings). No API keys, service-role tokens, or profile directories logged.

## Remaining gaps

- Click **Check** on each card and capture post-check UI (rate-limited live probes).
- Devpost **degraded** locally — verify Playwright/browser deps (`browser missing`).
- Re-test after Hakku profile connect (manual `source:connect`).
- Re-test with Supabase-backed source snapshots vs in-memory mock banner.
- Connected Luma mode when implemented.

## Key screenshot references

| Scenario | Path |
|---|---|
| Full Sources panel (desktop) | `artifacts/sources/settings-sources__1440x1000.png` |
| Full Sources panel (phone) | `artifacts/sources/settings-sources__390x844.png` |
| Hakku card | `artifacts/sources/hakku-card-laptop__1440x1000.png` |
| Luma card | `artifacts/sources/luma-card-laptop__1440x1000.png` |
| Terminal `/sources` parity | `artifacts/terminal/sources__1440x1000.png` |
