# Phase 5.6.2 Query Constraint Correctness Audit

Date: 2026-07-15 America/Toronto
Branch: `experiment/phase-5-6-2-query-constraint-correctness`
Base: `5e5b84e672a17de8c2b2d099c649de07d8ed180c`
Expected remote base noted by prompt: `fabe31c4f4f241a79a0643e12fa68e886d5426ca`; this local branch also includes `5e5b84e` (`fix(auth): use stable app password env`).

Scope: discovery date, location, remote, participant-eligibility, profile, terminal flag, and output-label correctness. No production integration, persistence schema migration, deployment, X run, WAF/CAPTCHA bypass, native collector weakening, merge, or main push was performed.

## Implementation Summary

- Terminal execution flags are stripped from natural-language planner text:
  - `--profile light|standard|deep|exhaustive`
  - `--remote`
  - `--include-remote`
  - `--onsite-only`
  - `--dry-run`
  - `--verbose`
- Unknown discovery flags now fail clearly instead of becoming search terms.
- The normalized event model now distinguishes:
  - `eventStartDate`
  - `eventEndDate`
  - `registrationOpenDate`
  - `registrationDeadline`
  - `applicationDeadline`
  - `submissionDeadline`
  - `resultAnnouncementDate`
  - `parsedDateEvidence[]`
- Date extraction only maps concrete roles from explicit labels or structured fields. Event dates are not copied into application deadlines.
- Output now prints `Event`, `Applications close`, optional `Submission deadline`, `Location`, `Mode`, `Eligibility`, `Status`, and `Source`.
- Added an explicit invariant guard rejecting a concrete application deadline with `deadlineState=missing`.
- Location parsing now models `EventLocation` with mode/city/region/country/rawText/confidence.
- Query parsing now distinguishes `locationConstraint: event_location | participant_eligibility | none` and `remotePolicy: exclude | include | only | inferred_open`.
- Strict city queries exclude remote-only results unless the user asks for remote inclusion.
- No-location queries allow remote, hybrid, physical, and unknown-location candidates subject to event/date/theme quality.
- Hard gates now reject non-hackathon/social/profile/date-only records before scoring, including generic Luma social events, standalone social pages, and obvious non-event titles.

## Manual Scenario Results

All scenarios were run in deterministic dry-run mode with persistence skipped. Trace logs are local under `.local-audits/traces/phase-5-6-2/manual/`.

| Scenario | Raw | Unique | Extracted | Accepted | Rejected | Needs Review | Modes In Accepted | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A strict Toronto | 282 | 243 | 282 | 19 | 224 | 19 | 17 in-person, 2 hybrid | No remote accepted; all accepted locations printed as Toronto, Canada. |
| B Toronto plus remote | 282 | 244 | 282 | 54 | 190 | 54 | 36 remote, 14 in-person, 4 hybrid | Remote-inclusive natural language worked. |
| C `--include-remote` | 282 | 244 | 282 | 54 | 190 | 54 | 36 remote, 14 in-person, 4 hybrid | Matches scenario B remote policy. |
| D Canada eligibility | 275 | 216 | 275 | 51 | 165 | 51 | 39 remote, 7 in-person, 5 hybrid | Participant eligibility permits remote/global candidates for Canada review. |
| E no location next month | 279 | 218 | 279 | 71 | 147 | 71 | 38 remote, 17 in-person, 11 hybrid, 5 unknown | No Toronto/Canada default; mixed modes allowed. |
| F onsite-only Toronto | 282 | 243 | 282 | 11 | 232 | 11 | 11 in-person | Remote/hybrid excluded by onsite-only policy. |

## Manual Precision Review

Manual review was all accepted results for scenarios under 50 and stratified visible samples for larger scenarios.

| Scenario | Event-Type Precision | AI/Theme Precision | Location Precision | Remote-Mode Precision | Event-Date Precision | Application-Deadline Precision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A strict Toronto | high; social Luma noise rejected after fix | high/plausible | 19/19 printed Toronto | 19/19 no remote | 1 concrete / 18 unknown; concrete date plausible | 0 concrete / 19 unknown; unknown preserved |
| B Toronto plus remote | high/plausible sample | high/plausible sample | Toronto physical plus remote only in sample | remote inclusion correct | mostly unknown | mostly unknown |
| C `--include-remote` | same as B | same as B | same as B | same as B | mostly unknown | mostly unknown |
| D Canada eligibility | useful but review-heavy | high/plausible sample | eligibility and event location displayed separately | remote/global inclusion correct | mostly unknown | mostly unknown |
| E no location | useful but broad/review-heavy | high/plausible sample | no hidden Toronto/Canada default observed | mixed modes allowed | mostly unknown | mostly unknown |
| F onsite-only Toronto | high/plausible | high/plausible | 11/11 printed Toronto | 11/11 in-person | 1 concrete / 10 unknown | 0 concrete / 11 unknown; unknown preserved |

Precision note: date field precision is intentionally not reported as an aggregate. The app now avoids fabricating dates, so many accepted candidates remain `NEEDS_REVIEW` because event dates and application deadlines are still unknown after bounded enrichment.

## Remaining Ambiguity

- Application deadlines are rarely present in public listing cards and remained unknown in most live manual outputs.
- Event dates are often missing from web/Luma/Hakku listing snippets and remain `NEEDS_REVIEW` rather than queue-ready.
- Detail enrichment exists in the shared pipeline and ran during the manual scenarios, but it does not always find official labelled date fields within the bounded budget.
- A few accepted web/social snippets are plausible hackathon leads but still require human review because titles/snippets are not enough for queue-ready date certainty.

## Profile Behavior

- `--profile light` strips from planner text and caps collection through the execution options.
- Strict filtering is allowed to return fewer accepted results than the target.
- `light`, `standard`, `deep`, and `exhaustive` are parsed and mapped to distinct max-result targets in the CLI/service path.

## Verification

- `npm run typecheck`: passed.
- `npm run check`: passed, with pre-existing warnings in `src/lib/perf/timing.ts` and `src/server/sheets/reconcileCandidateSheetState.test.ts`.
- `npm test`: passed, 490 tests.
- `npm run test:scraper`: passed, 84 tests.
- `npm run test:integration`: passed, 194 tests.
- `npm run test:deterministic`: passed, 770 tests.

## Decision

Phase 5.6.2 passes the correctness gate for terminal flag stripping, normalized date roles, no event-date/application-deadline conflation, strict Toronto/remote/onsite behavior, participant-eligibility parsing, no-location mixed-mode behavior, non-hackathon Luma/social rejection, dry-run no persistence, and deterministic suite verification.

The main remaining product gap is coverage of concrete event/application dates from live official detail pages. Unknown values are preserved and routed to `NEEDS_REVIEW`; no migration was required.
