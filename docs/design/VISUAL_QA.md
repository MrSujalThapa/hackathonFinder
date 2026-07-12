# Visual QA — before / proposed / after

## Method

- Playwright (Node) with domcontentloaded settle (Python unavailable on host)  
- Widths: 390×844, 768×1024, 1440×1000, 1728×900  
- Artifacts: `artifacts/design/before`, `proposed`, `after`  
- Step 15 capture: `scripts/design-after-capture.ts` → `artifacts/design/after/`  
- Auth: mock owner password + `USE_MOCK_CANDIDATES=true`  
- Reduced-motion: `queue-reduced-motion__390x844.png`

## Step 15 acceptance checks

| Check | Expected | Actual | Severity | Correction / deviation |
|------|----------|--------|----------|------------------------|
| Queue at rest | One card, no instructional clutter | Quieter queue; progress `1 of N`; `?` help only | Pass | — |
| No More details button | Chevron / Enter opens detail | No `More details` control in DOM or screenshots | Pass | — |
| No permanent Keyboard banner | Shortcuts behind `?` | No `Keyboard:` banner; panel lists ←/→/S/Enter | Pass | — |
| No Reject/Save/Approve row on queue card | Swipe + `⋯` menu | Permanent row absent; labels only inside closed `⋯` menu | Pass | Closed-menu items ignored by harness |
| Keyboard shortcuts exist | Left/Right/S/Enter | `aria-label="Keyboard shortcuts help"` + panel content verified | Pass | — |
| Ask composer | Placeholder, no “Ask anything” heading | `Ask about this event…`; no heading | Pass | — |
| Candidate detail reachable | Queue → detail | Opened mock candidate (e.g. HackTO / Sparse Details Summit) | Pass | Prefer live queue id after mock reset |
| Horizontal overflow | None | `scrollWidth === clientWidth` across captures | Pass | — |
| Approved / Rejected / Saved / Settings | Blueprint shell | Captured at all four widths | Pass | — |
| Console | No new product errors | `after/console.json` — no material console errors in Step 15 run | Pass | Dev mock banner expected |

## Findings (cumulative)

| Area | Expected | Actual | Severity | Correction / deviation |
|------|----------|--------|----------|------------------------|
| Queue scan | Status → title → facts → summary → decisions | After: quieter hero, cleaned summary, swipe-first (no permanent decision bar) | Low | Accepted; score quieter but present |
| Decision targets | ≥44px where shown | `hf-touch` on help / `⋯` / detail actions | Pass | Queue decisions via swipe/keyboard/`⋯` |
| Detail desktop | Document + rail | Rail at `xl` with facts/actions | Pass | Tags on rail at xl |
| Evidence | Authority hierarchy | Left-border types retained | Pass | — |
| Ask | Open-ended composer | Placeholder only; chips removed | Pass | Matches Step 15 “no Ask anything heading” |
| Empty/error | Left-aligned notices | Empty/Error no longer centered dashed cards | Pass | — |
| Login | Calm panel | Brand-first, no nav chrome | Pass | — |
| Supporting lists | Compact rows | Mostly prior list chrome | Medium | Remaining limitation — denser list polish deferred |
| Motion | Reduced motion skips GSAP polish | Emulated reduce captured | Pass | — |
| Detail by UUID | Stable mock detail | Hardcoded id can 404 after store churn | Low | Accepted; reset + queue-driven id preferred |

## Accessibility spot checks

- Focus-visible rings via `hf-btn` / inputs  
- Decision buttons labeled on detail  
- Error/empty use `role="alert"` / `role="status"`  
- Touch min height 44px on primary actions  
- Keyboard help control labeled  

## Screenshot index (after / Step 15)

Viewports: `__390x844`, `__768x1024`, `__1440x1000`, `__1728x900`

- `queue-at-rest`, `queue` (alias), `queue-reduced-motion` (390 only)  
- `approved`, `rejected`, `saved`, `settings`, `login`  
- `candidate-detail`, `ask-composer`  
- Harness log: `console.json`

## Accepted remaining limitations

- History list pages not fully redesigned to compact editorial rows  
- Score badge still used (quieter context) rather than fully demoted  
- Proposed mockups used design-lab fonts (IBM Plex / Source Serif); production uses Geist + Source Serif 4  
- Python Playwright module unavailable; Node Playwright used with same workflow  
- Next.js HMR can abort Playwright `load` navigations during script edits — capture with warm routes + `domcontentloaded`
