# B3 native kernel report

**Branch:** `experiment/scraper-overhaul-b3-native-kernel`  
**Base:** `578e332` (B2 custom kernel)  
**Measured:** 2026-07-16

## Live probes (`scripts/b3-native-kernel-probe.ts`)

| Run | Unique | Listing ms | Detail ms | Total ms | Gate |
|---|---:|---:|---:|---:|---|
| Devpost light | **75** | 844 | 835 | 1,681 | PASS (50–100, `full_directory_api`) |
| Devpost deep | **500** | 4,527 | 7,024 | 11,552 | PASS (≥300, cap behavior) |
| Luma light | **44** | — | — | 23,910 | recorded |
| Luma deep | **128** | — | — | 42,429 | PASS (≥100) |
| Hakku light | **79** | — | — | 11,216 | auth + scroll OK |

Artifact: `.local-audits/traces/b3-native-kernel/parity-1784212988936.json`

### Latency vs B1

| | B1 | B3 | Notes |
|---|---:|---:|---|
| Devpost light | 1.9s | 1.7s | no regression |
| Devpost deep | 11.9s | 11.6s | no regression |
| Luma deep | 48.1s | 42.4s | no regression |

Devpost listing remained faster than the 15% slower gate.

## Custom regression (B2 benchmark, untouched adapters)

| Source | Result |
|---|---|
| hackathons.space | **30** unique |
| Eventornado | honest partial (`usable_partial` / degraded) |
| Taikai | **40** unique (`maximum_cards_reached`) |
| DoraHacks | `blocked_human_verification` |

## Luma timeline flake

Fixed: `parseLumaHtml` now passes fixture `now` into `isUpcoming`. Five consecutive focused Luma suite runs: 27/27 pass each.

## Tests

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | 566 pass |
| `npm run test:scraper` | 84 pass |
| `npm run test:integration` | 209 pass |
| `npm run test:deterministic` | pass (see log) |
| Luma focused ×5 | stable |
| `native.parity.test.ts` | pass |

## Import graph

- Natives: `@/crawl` / `@/crawl/adapters/{devpost,luma}`
- Collectors/discovery/crawl: **0** static production imports of `src/experiments/**`
- Experiment shims retained for B4

## B3 gate: **PASS**

No B4 deletion, persistence change, migration, deploy, X, merge, or main push.
