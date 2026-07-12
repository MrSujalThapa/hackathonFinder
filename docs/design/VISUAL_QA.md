# Visual QA — before / proposed / after / final

## Method

- Playwright (Node) with `domcontentloaded` settle (Python Playwright unavailable on host)
- Auth: mock owner password + `USE_MOCK_CANDIDATES=true` on `localhost:3000`
- Harness scripts:
  - Step 15: `scripts/design-after-capture.ts` → `artifacts/design/after/`
  - Corrective baseline: `scripts/design-corrective-before-capture.ts` → `artifacts/design/corrective-before/`
  - **Step 11 final:** `scripts/design-final-after-capture.ts` → `artifacts/design/final-after/`
- Reduced-motion: `artifacts/design/after/queue-reduced-motion__390x844.png` (Step 15)

## Step 11 final acceptance (2026-07-12)

Viewports: 390×844, 430×932, 768×1024, 1024×900, 1440×1000, 1728×900, 1920×1080  
Artifacts: `artifacts/design/final-after/` (+ key copies in `artifacts/design/final-before/` because that folder was empty; full before baseline remains in `corrective-before/`)

### Queue cardWidth

| Viewport | cardWidth | Pass criterion | Result |
|----------|-----------|----------------|--------|
| 1440×1000 | **873** | ≥ 600 | **Pass** |
| 1920×1080 | **873** | measured | Pass (same max-width cap) |
| 1728×900 | 873 | — | Cap holds |
| 1024×900 | 729 | — | — |
| 768×1024 | 698 | — | — |
| 430×932 | 386 | — | — |
| 390×844 | 347 | — | — |

No horizontal overflow on any queue viewport (`scrollWidth === clientWidth`).

### Checklist

| Check | Expected | Actual | Severity | Result |
|------|----------|--------|----------|--------|
| No More details button | Chevron / Enter opens detail | Absent on queue | Blocker | **Pass** |
| No permanent Keyboard banner | Shortcuts behind `?` only | No `Keyboard:` banner | Blocker | **Pass** |
| No Approve/Reject/Save row on queue | Swipe + `⋯` menu | Permanent row absent; `⋯` only | Blocker | **Pass** |
| cardWidth @ 1440 | ≥ 600 | 873 | Blocker | **Pass** |
| Detail reachable | Queue → detail + Ask | `/candidate/aaaaaaaa-aaaa-4aaa-8aaa-000000000001` | Blocker | **Pass** |
| Ask factual `date?` | HTTP 200, no raw dump | Dates + Confirmed; no snippet leaks | High | **Pass** |
| Ask decision | HTTP 200 structured | STRONG YES + why / next step | High | **Pass** |
| Console / failed requests | Clean | Empty `console.json` product errors; no non-`_next` 4xx/5xx | Medium | **Pass** |
| Approved / Rejected / Saved / Settings | Blueprint shell all widths | Captured 7 widths each | — | **Pass** |

### Material mismatches

None blocking. Accepted notes:

| Area | Expected | Actual | Severity | Correction / deviation |
|------|----------|--------|----------|------------------------|
| Wide unused space | Card grows with viewport | cardWidth caps ~873 from 1440→1920; unusedPct ~39–55% | Low | Accepted max-width; width floor met |
| History lists | Compact editorial rows | Supporting lists still denser than queue hero | Medium | Deferred polish |
| Mock banner | Dev-only | Expected with `USE_MOCK_CANDIDATES=true` | Info | — |

## Screenshot index (final-after / Step 11)

Labels × viewports (`__390x844` … `__1920x1080`):

- `queue`, `approved`, `rejected`, `saved`, `settings`
- `candidate-detail`, `ask`
- Answer shots (1440 only): `ask-factual`, `ask-decision`
- Harness: `metrics.json`, `console.json`

Key copies (folder was empty): `artifacts/design/final-before/` — queue/detail/ask/settings at 1440 + 1920.

## Step 15 acceptance checks (prior)

| Check | Expected | Actual | Severity | Correction / deviation |
|------|----------|--------|----------|------------------------|
| Queue at rest | One card, no instructional clutter | Quieter queue; progress `1 of N`; `?` help only | Pass | — |
| No More details button | Chevron / Enter opens detail | No `More details` control | Pass | — |
| No permanent Keyboard banner | Shortcuts behind `?` | No `Keyboard:` banner | Pass | — |
| No Reject/Save/Approve row on queue card | Swipe + `⋯` menu | Permanent row absent | Pass | Closed-menu items ignored by harness |
| Keyboard shortcuts exist | Left/Right/S/Enter | `aria-label="Keyboard shortcuts help"` | Pass | — |
| Ask composer | Placeholder, no “Ask anything” heading | `Ask about this event…` | Pass | — |
| Horizontal overflow | None | Verified | Pass | — |

## Findings (cumulative)

| Area | Expected | Actual | Severity | Correction / deviation |
|------|----------|--------|----------|------------------------|
| Queue scan | Status → title → facts → summary → decisions | Quieter hero, swipe-first | Low | Score quieter but present |
| Decision targets | ≥44px where shown | `hf-touch` on help / `⋯` / detail actions | Pass | Queue via swipe/keyboard/`⋯` |
| Detail desktop | Document + rail | Rail at `xl` with facts/actions | Pass | — |
| Ask | Open-ended composer + structured answers | Factual + decision both HTTP 200; no raw dumps | Pass | See `ASK_QA.md` |
| Empty/error | Left-aligned notices | No centered dashed cards | Pass | — |
| Supporting lists | Compact rows | Mostly prior list chrome | Medium | Deferred |

## Accessibility spot checks

- Focus-visible rings via `hf-btn` / inputs
- Decision buttons labeled on detail
- Error/empty use `role="alert"` / `role="status"`
- Touch min height 44px on primary actions
- Keyboard help control labeled

## Accepted remaining limitations

- History list pages not fully redesigned to compact editorial rows
- Score badge still used (quieter context) rather than fully demoted
- Queue card max-width ~873px leaves unused space on ultra-wide
- Python Playwright module unavailable; Node Playwright used
- Next.js HMR can abort Playwright `load` navigations — capture with warm routes + `domcontentloaded`
