# Phase 11 Manual Acceptance Checklist

Do not deploy from this checklist. Do not call or test X.

## Database Persistence

1. Review `supabase/migrations/007_terminal_sessions.sql`.
2. Apply migration `007_terminal_sessions.sql`.
3. Verify `public.terminal_sessions` exists.
4. Verify `public.terminal_command_history` exists.
5. Verify `public.discovery_jobs.terminal_session_id` exists.
6. Restart the application.
7. Verify `/api/terminal/storage` reports:

```json
{
  "mode": "database",
  "durable": true,
  "migrationReady": true
}
```

## Terminal Persistence

1. Create three terminal sessions.
2. Start jobs in all three sessions.
3. Refresh and confirm all sessions restore.
4. Navigate away and return.
5. Confirm each session's output remains isolated.
6. Confirm command history remains isolated per session.
7. Confirm draft text remains isolated per session.
8. Confirm selected jobs remain isolated per session.
9. Restart Next.js.
10. Confirm completed sessions and linked jobs restore from the database.
11. Run `/clear` and confirm persisted job events remain recoverable through `/history` or restored session output.
12. Close a terminal with a running or completed job.
13. Confirm the job remains visible in `/jobs`.

## Source Connections

1. Run `/source connect hakku`.
2. Log into Hakku manually once in the opened browser.
3. Close the browser.
4. Run `/source status hakku`.
5. Confirm Hakku reports connected.
6. Restart the application.
7. Run `/source status hakku`.
8. Confirm Hakku still reports connected.
9. Run `/source check hakku`.
10. Run `/source disconnect hakku`.
11. Confirm it asks for `/confirm disconnect hakku`.
12. Let one confirmation expire and confirm it is rejected.
13. Run disconnect again, then `/confirm disconnect hakku`.
14. Confirm only the Hakku saved browser session is removed.
15. Run `/source status luma`.
16. Run `/source check luma`.
17. Run `/source connect luma`.
18. Confirm Luma remains public-mode/no-auth.

## Source Discovery

1. Run Hakku-only discovery.
2. Run Luma-only discovery.
3. Run Devpost-only discovery.
4. Run HackList-only discovery.
5. Run MLH-only discovery.
6. Run web-only discovery.
7. Run all enabled sources.
8. Verify source failure isolation.
9. Verify queue updates after approved/rejected/saved candidates.
10. Verify no X calls were made.

## Concurrency And Cancellation

1. Start multiple terminal jobs.
2. Confirm the active limit is respected.
3. Confirm excess jobs queue.
4. Cancel one active job.
5. Confirm only that job is cancelled.
6. Confirm a queued job starts when a slot is released.
7. Switch tabs repeatedly and confirm no duplicate SSE output.
8. Refresh during execution and confirm streaming continues.
9. Navigate away and return during execution and confirm streaming continues.
10. Stop and restart Next.js only after a local in-process job, and record that local in-process jobs do not survive process stop.

## Remaining Deployment Work

1. Configure production Supabase with migrations `006` and `007`.
2. Use database-backed terminal and discovery stores.
3. Configure worker mode for deployment.
4. Run production smoke checks.
5. Verify secrets are redacted in logs, terminal output, source diagnostics, and screenshots.
