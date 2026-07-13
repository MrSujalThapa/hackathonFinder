# Terminal architecture audit (Phase 11 · Step 1)

Branch: `step-11-terminal-and-source-reliability`  
Scope: controlled discovery console at `/terminal` — **not** a system shell.  
Related: `docs/discovery/TERMINAL.md`, `supabase/migrations/006_discovery_jobs.sql`, proposed `007_terminal_sessions.sql`.

## 1. Current architecture

### Client path

1. `DiscoveryTerminal` owns React state: `lines`, command `history`, `activeJob`, SSE refs.
2. Submit → `parseTerminalCommand`: `/find` or natural language → find; slash meta-commands; shell-like input rejected.
3. Find → `createDiscoveryJob` → `POST /api/discovery/jobs`.
4. On success → `attachStream(jobId)` → `EventSource` on `GET /api/discovery/jobs/:id/events?after=N`.
5. Events → `jobEventToTerminalLine` → append to `lines`.
6. Stream end → fetch job → summary UI; completed runs refresh queue best-effort.
7. Deep-link `?job=` reloads job and re-attaches SSE if still active.
8. Unmount → `EventSource.close()` only — **does not cancel** the job.

### API / enqueue

- Owner session + same-origin + rate limit.
- `enqueueDiscoveryJob`: source allowlist → active/queued admission → create job → events.
- Local mode: fire-and-forget `executeDiscoveryJob` in-process.
- Worker mode: leave queued for claim loop.
- Cancel: cooperative `cancel_requested` + `run_cancelled` event.

### Persistence today

| Concern | Store |
|---|---|
| Jobs + events | Supabase (`006`) or DEV memory |
| Candidates / evidence | Existing pipeline |
| Terminal lines / ↑↓ history / UI active job | **React only** |
| Terminal session repository | Supabase (`007`) or DEV memory |
| Drafts / scroll position | localStorage UI convenience only |
| Hakku login | Filesystem browser profile |

## 2. Failure points

- Soft active-job limit historically racy (improved with concurrency gate).
- Local in-process execution vs serverless process death.
- Memory store lost on restart.
- SSE disconnect without cancel → operator loses live feed; job continues.
- Cancel is cooperative.
- Hakku profile contention without lock (mitigated by source lock module).
- No multi-session model in UI yet (schema proposed).

## 3. Persistence boundaries

**React-only:** console lines, local command history, submitting flags, live SSE attachment.

**Durable (when `006` applied):** job row, event log, cancel flag, claim metadata.

**Durable (when `007` applied):** terminal sessions, selected session, active/selected job ids, per-session command history.

**Development-only:** the in-memory terminal repository is non-durable and logs:

```text
Terminal persistence is using the development memory store.
Apply migration 007 for durable sessions.
```

**`/clear`:** clears React lines only — does **not** delete jobs/events.

## 4. Concurrency boundaries

- Defaults: `DISCOVERY_MAX_ACTIVE_JOBS=2`, `DISCOVERY_MAX_QUEUED_JOBS=10`.
- Excess jobs queue with position events.
- Hakku: exclusive profile lock (1).
- Public sources: bounded shared pool.
- Source lock timeout degrades that source only.

## 5. Desired architecture

1. Keep `discovery_jobs` / `discovery_job_events` as run/event source of truth.
2. Add `terminal_sessions` (`007`) for multi-tab sessions linked to jobs.
3. On load: restore sessions → resume SSE from last sequence.
4. Navigation: detach SSE only; jobs keep running; reattach on return.
5. Per-terminal event store keyed by `terminalSessionId → jobId → sequence`.
6. Profile lock / source affinity for Hakku across jobs.

## 6. Migration impact — `007_terminal_sessions`

Proposal only — **do not apply without approval**.

- `terminal_sessions` table
- optional `terminal_command_history`
- `discovery_jobs.terminal_session_id` nullable FK

See `docs/discovery/TERMINAL_MIGRATION.md`.

## 7. Local-mode limitations

- In-process execution; stopping the Next.js process interrupts jobs.
- Memory store common until `006` applied.
- Browser profiles assume shared local disk.
- Navigation, refresh, tab switching, terminal close, and SSE disconnect do not cancel a job. Stopping the entire Next.js process still interrupts local in-process jobs because local execution lives inside that process. Worker mode is the deployment solution for process-independent execution.

## 8. Worker-mode behavior

- Enqueue leaves job `queued`; worker claims → heartbeat → execute.
- Needs durable store + shared profile volume for Hakku.
- Compatible with concurrency gate and source locks.

## Specific answers

| Question | Answer |
|---|---|
| Navigation cancel jobs? | **No** — closes SSE only |
| `/clear` delete durable state? | **No** |
| Multiple active jobs blocked? | Bounded by max active; excess queued |
| Hakku concurrent same profile? | **Serialized** via profile lock |
| Shell execution? | **No** — typed parser + API reject |
