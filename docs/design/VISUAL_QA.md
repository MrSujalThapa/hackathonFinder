# Visual QA — before / proposed / after

## Method

- Playwright (Node) with load + short networkidle settle  
- Widths: 390×844, 768×1024, 1440×1000  
- Artifacts: `artifacts/design/before`, `proposed`, `after`  
- Reduced-motion: `queue-reduced-motion__390x844.png`

## Findings

| Area | Expected | Actual | Severity | Correction / deviation |
|------|----------|--------|----------|------------------------|
| Queue scan | Status → title → facts → summary → decisions | After: quieter hero, cleaned summary, rectangular decision bar | Low | Accepted; score still present but smaller role |
| Decision targets | ≥44px | `hf-touch` decision buttons | Pass | — |
| Detail desktop | Document + rail | Rail at `xl` with facts/actions | Pass | Tags hidden from main on xl |
| Evidence | Authority hierarchy | Left-border types retained | Pass | — |
| Ask | Open-ended composer | Placeholder + chips as shortcuts | Pass | — |
| Empty/error | Left-aligned notices | Empty/Error no longer centered dashed cards | Pass | — |
| Login | Calm panel | Brand-first, no nav chrome | Pass | — |
| Console | No new errors | Capture log in `after/console.json` | Review | Check for hydration noise |
| Detail by UUID | Stable mock detail | Earlier before-run hit “not found” after store churn | Low | Accepted deviation; queue-driven open preferred |
| Supporting lists | Compact rows | Mostly prior list chrome | Medium | Remaining limitation — denser list polish deferred |
| Motion | Reduced motion skips GSAP polish | Emulated reduce captured | Pass | — |

## Accessibility spot checks

- Focus-visible rings via `hf-btn` / inputs  
- Decision buttons labeled  
- Error/empty use `role="alert"` / `role="status"`  
- Touch min height 44px on primary actions  

## Accepted remaining limitations

- History list pages not fully redesigned to compact editorial rows  
- Score circle still used (quieter context) rather than fully demoted  
- Proposed mockups used design-lab fonts (IBM Plex / Source Serif); production uses Geist + Source Serif 4  
- Python Playwright module unavailable; Node Playwright used with same workflow
