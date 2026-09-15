# Opportunity applications

## Architecture

Discovery continues to produce candidate rows, now with an `opportunity_type` defaulting to `hackathon`. The application service consumes a candidate; it does not participate in discovery planning.

`Opportunity → Application → Application questions → Human review → guarded submission`

The implementation intentionally does not use LangGraph. Supabase rows already provide the durable pause/resume boundary: extracted fields and draft answers are saved before a `needs_input` or `ready_for_review` state is exposed. A small state-machine service is easier to inspect, test, and operate than an additional graph runtime.

## States and safety

`not_started → drafting → needs_input|ready_for_review → approved → submitting → submitted`

- `approved` records `approved_at`, `approved_by`, and `approved_draft_version`.
- Changing any answer clears approval and returns the draft to review.
- `beginSubmission` rejects every state except an unchanged approved version.
- The current browser inspector is read-only. It pauses for CAPTCHA, login, MFA, payment, or legal agreements. No endpoint performs a live submission.

## Deterministic resolution and cost controls

Profile field lookup and Question Bank matching run before model use. Exact aliases win; fuzzy matching requires a clear threshold. Remaining text fields use one structured batched call. Draft metrics expose model calls, tokens, and the deterministic/AI/user resolution counts.

## Persistence and operations

Migration `011_opportunity_applications.sql` adds opportunity metadata, applications, application questions, profiles, Question Bank entries, and notifications. Apply it through the normal Supabase migration workflow before enabling the UI in production.

Run the opening/deadline tracker as a scheduler/cron target:

```text
npm run worker:applications:once
```

It persists deduplicated in-app notifications. The notification service exposes an injectable email interface; deployment wiring can add an email provider without changing application logic.

## Routes

- `/applications` — prepare safe fixture or read-only browser inspection; list drafts
- `/applications/:id` — edit every answer and approve an exact draft
- `/profile` — factual reusable fields
- `/questions` — Question Bank
- `/notifications` — in-app notification inbox
