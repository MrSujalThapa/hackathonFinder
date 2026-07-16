# B1 parity report

**Measured:** 2026-07-16 (live probe `scripts/b1-parity-probe.ts`)  
**Base A1/A2 HEAD:** `8b010605e518cb82da774d1c2606a5916d5df609`

## Deterministic

| Suite | Result |
|---|---|
| `npm test` | 524 pass |
| `npm run test:integration` | 209 pass |
| `npm run test:deterministic` | 819 pass |
| `npm run typecheck` | pass |
| Kernel contract tests | pass (target vs cap, no-growth, timeout, cancel, release, progress, re-export parity) |

## Live parity

| Run | Unique | Duration | Gate |
|---|---:|---:|---|
| Devpost light | **75** | 1.9s | PASS (50–100) |
| Devpost deep | **500** | 11.9s | PASS (≥300) |
| Luma light | **46** | 34.0s | OK (may be &lt;100) |
| Luma deep | **129** | 48.1s | PASS (≥100) |

Prior A1/A2: Devpost light 75 / deep 500 / Luma deep 134. Within live variance; no material regression.

## Latency

| | Before (A1/A2 verify) | After B1 | Δ |
|---|---:|---:|---|
| Devpost light | ~3.8s | 1.9s | faster |
| Devpost deep | ~12.6s | 11.9s | ≈same |
| Luma deep | ~80s (theme probe) | 48s | faster / variance |

Listing-first progress preserved (API/scroll logs appear immediately). No cancellation path change for collectors.

## hackathons.space

Production path unchanged (`genericScraperV2Mode` + existing unit coverage). No B2 routing. Experiment-import count remains **2** discovery files.

## Stop / source-state

- Scroll helpers still emit legacy `max_items` / `no_growth` / `max_scrolls` / `timeout`
- Kernel maps these via `mapStableScrollStopReason` without Terminal renames
- Target vs max-card distinction covered in kernel tests

## B1 gate: **PASS**
