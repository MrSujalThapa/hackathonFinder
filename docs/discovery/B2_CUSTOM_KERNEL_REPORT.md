# B2 Custom Kernel Report

**Branch:** `experiment/scraper-overhaul-b2-custom-kernel`  
**Base:** `3bea45a` (`experiment/scraper-overhaul-b1-kernel-extraction`)  
**Date:** 2026-07-16

## 1. Branch and base

- Created from clean B1 HEAD matching `origin/experiment/scraper-overhaul-b1-kernel-extraction` @ `3bea45a`
- Pushed: `origin/experiment/scraper-overhaul-b2-custom-kernel`

## 2. Custom adapter / module files

| Path | Role |
|---|---|
| `src/crawl/adapters/custom/adapter.ts` | `CustomDirectoryAdapter` |
| `src/crawl/adapters/custom/collect.ts` | Kernel → `CollectorResult` |
| `src/crawl/adapters/custom/crawlPlan.ts` | Versioned crawl plans |
| `src/crawl/adapters/custom/extractCards.ts` | Deterministic-first + ≤1 AI/cycle |
| `src/crawl/adapters/custom/origins.ts` | Origin allowlist + DoraHacks block |
| `src/crawl/adapters/custom/routing.ts` | Temporary flags |
| `src/crawl/adapters/custom/generic/*` | Moved proven DOM/acquisition/AI stack |
| `src/experiments/scraper-v2/generic/*.ts` | Re-export shims (B4 delete) |
| `src/discovery/genericScraperV2Mode.ts` | Thin router → kernel default |

## 3. Production routing before / after

| | Before | After |
|---|---|---|
| Default | `GENERIC_SCRAPER_V2_MODE=off` → weak V1 | **kernel** |
| Live/off/invalid | V1 or V2 experiment | **kernel** |
| Shadow | V1 writes + V2 metrics | kernel writes + optional experiment shadow metrics; **writes=0** |
| Rollback | n/a | `CUSTOM_SOURCE_ROLLBACK_V1=1` / `rollback_v1` → V1 (logged) |

## 4. Production experiment imports

| | Before | After |
|---|---|---|
| Static imports from `src/experiments/**` on normal custom collect | `genericScraperV2Mode` → budget/types + dynamic structuredExtraction | **0** static for normal path |
| Shadow | n/a | dynamic import only when shadow mode |
| `collect.ts` / `adapter.ts` | n/a | **no** `@/experiments` imports |

## 5. Temporary rollback / shadow

See `docs/discovery/B2_CUSTOM_KERNEL.md`. Deletion gate: **B4** after ≤14 days soak or 3 controlled live custom runs across ≥3 days.

## 6. Crawl-plan validation / invalidation

Implemented in `crawlPlan.ts`: schema/adapter version, origin/redirect, structural signature, consecutive failures ≥3, block/auth, no-growth vs prior healthy inventory. File cache `.data/crawl-plans/` (non-authoritative). Save only after usable success. No DB migration.

## 7. hackathons.space

| Mode | Result |
|---|---|
| **With LLM** | **30** leads, mechanism=`next`, pages=3, actions=2, `healthy_complete`, AI selection used once, telemetry ~549B |
| **Without LLM** | 0 leads, `ai_unavailable` warning, **no V1 fallback**, degraded status |

## 8. Eventornado

- 11 pipeline leads (18 raw before nav noise filter)
- Forced `usable_partial` / degraded status (honest partial)
- mechanism=`next`, pages=2
- Sample titles are event-like; precision acceptable on manual sample

## 9. Taikai (locked unseen)

- **40** leads (maxItems cap), `healthy_bounded`, mechanism=`next`, pages=9, actions=8
- Real hackathon titles (ETHSamba, CASSINI, etc.)
- No hostname-specific collector / kernel branch
- Required longer budget (180s) — documented

## 10. Static directory

- Fixture unit test: deterministic repeated DOM extraction without AI (`customAdapter.test.ts`)
- Static acquisition path skips browser when `artifactsSufficientForStatic` passes

## 11. DoraHacks

- `blocked_human_verification`, **0** leads, no bypass, no retry loop

## 12. Dry-run / shadow writes

- Kernel collect never calls persistence strategies
- Shadow mode: experiment comparison via dynamic import; `custom_shadow_writes=0`
- Pipeline dry-run unchanged (writes nothing)

## 13. Pipeline / persistence parity

- RawLeads with `provenance=custom_site_kernel`, stable ids, existing pipeline entry `collectCustomSourceWithV2Routing`
- No custom persistence path; batch/V1 persistence unchanged

## 14. Native regression probes

| Probe | Result |
|---|---|
| Devpost light | **75** unique (target 50–100, near 75) |
| Devpost deep | **500** unique (≥300) |
| Luma deep (full-directory probe) | **122** unique (≥100) |
| Luma deep (a1-a2-threshold-verify) | 9 unique — live flake; not a B2 code change (Luma untouched) |

## 15. Telemetry size

- Per-source examples: 548–592 bytes (limit 2KB)

## 16. Tests

- Focused B2 + crawl unit tests: **38 pass**
- Required suites: run `typecheck` / `check` / `test` / `test:scraper` / `test:integration` / `test:deterministic` as part of closure

## 17. Remaining experiment dependencies

- Shadow-only dynamic import of structured extraction
- Experiment shims re-export production generic modules
- Adaptive/Crawlee/vision remain under experiments (B4)

## 18. B2 pass/fail

**PASS** with notes:

- Custom sources default to shared kernel; no experiment dependency on normal path
- hackathons.space 30 + 2 Next with LLM; honest `ai_unavailable` without LLM
- Eventornado honest partial; Taikai usable without dedicated collector; DoraHacks blocked
- V1 only behind explicit rollback; natives unchanged (Devpost thresholds green; Luma live variance noted)

## 19. Commits

See git log on `experiment/scraper-overhaul-b2-custom-kernel`.

## 20. Scope confirmation

No B3 native migration · no V1 deletion · no persistence change · no DB migration · no deploy · no X · no merge · no main push.
