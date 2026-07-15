# Phase 6.1 Integration Closure

## Branch
- Branch: `experiment/phase-6-1-integration-closure`
- Exact base: `84b66ab4e91bdf1db35e11dc73758fcce36c13d4`

Local browser/CLI traces also live under `.local-audits/traces/phase-6-1/` (gitignored).

## Root cause (hackathons.space)
Phase 6 production-path probe (`scripts/phase6-custom-v2-probe.ts`) did not call `loadLocalEnv()`, so `LLM_PROVIDER` / `LLM_API_KEY` were unavailable. hackathons.space V2 requires AI page-decision to select the correct DOM unit set; without LLM assist it returns `acquisition_failed` (0 valid) and falls back to V1 (~2 events). Eventornado still worked without AI (deterministic path).

Config parity gaps vs harness (secondary, now closed):
- `allowedOrigins` includes www/apex variants
- `maxPayloadBytes` 5MB
- harness-aligned pages/actions for hackathons.space
- production path passes `inferDiscoveryBudget`
- clear log when LLM is missing

## Restored live custom-source result
Controlled production routing (`collectCustomSourceWithV2Routing`, mode=live, env loaded):
- canonical URL `https://www.hackathons.space/`
- 31 valid / 31 normalized
- 2 accepted Next transitions / 3 pages requested
- ~94% recall vs estimated 33 available
- `healthy_complete`
- provenance `custom_site_v2`

## Off / shadow / live
| Mode | Result |
|------|--------|
| off | V1 only (~2 leads); no V2 warnings |
| shadow | V2 valid=31, `generic_v2_writes=0`, V1 leads returned |
| live | V2 leads enter pipeline (31), no V1 fallback |
| invalid/missing | resolves to off |
| DoraHacks | blocked_human_verification, no bypass |
| Eventornado live | 18 leads, `degraded_under_extraction`, partial warning |

## Stable-input idempotency
Fixture-based `planPersistence` tests (not live web):
- identical inputs rerun → creates=0, no duplicate candidates/evidence, owner/sheet fields preserved
- one new fingerprint → exactly one create; existing unchanged

## Authenticated Terminal
### A — Toronto light dry-run
- Interpretation correct (remote excluded, dates, light, dry-run)
- Progressive streaming worked; Luma did not block earlier Devpost/Hakku lines
- Summary: raw 322 / unique 291 / queue-ready 1 / needs review 15 / rejected 275 / duration ~27s
- Dry-run projected creates (no applied writes)

### B — Remote deep dry-run
- Deep budgets shown (Devpost 500/80/80, Luma 350/80/120)
- Summary: raw 389 / unique 348 / queue-ready 1 / needs review 43 / duration ~30s
- Devpost collected 165 (deeper than light)

### C — Toronto light real run
- dry-run no; batch persistence executed
- created 0 / updated 0 (date-less query rejected all leads; web Tavily 432; Luma 0)
- Queue remained at 16 pre-existing items; owner/Sheets untouched

## NEEDS_REVIEW
- Soft flag `Applications close: Unknown` no longer forces review alone when event date exists
- Scenario A: dated Luma event → `NEW`; undated web listings → still `NEEDS_REVIEW`

## Result-count semantics
Terminal summary uses raw collected / unique / queue-ready / needs review / rejected / created|would create / updated|would update. No aggregate `accepted` label.

## Suites
- typecheck, check, test, test:scraper, test:integration, test:deterministic — pass
- Timing flake isolated: in-process budget race replaces cold tsx spawn

## Constraints
No migration, deploy, X use, DoraHacks WAF bypass, merge to main, or main push.

## Merge recommendation
**Merge-ready** for Phase 6.1 closure on this experiment branch, with remaining user-visible limits: Tavily 432 flakiness, Eventornado honest partial, DoraHacks blocked, and many undated listings still needing review.
