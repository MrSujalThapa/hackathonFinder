# Terminal session persistence (proposal — do not apply without approval)

Migration: `supabase/migrations/007_terminal_sessions.sql`  
Depends on: `006_discovery_jobs.sql`

## Why

The discovery terminal currently keeps session UI state (selected console, arrow-up command history) in React only. Jobs and events already have a durable path via migration 006; sessions do not. Multi-session tabs and refresh/navigation require durable session rows plus an optional FK from jobs.

## Schema summary

### `terminal_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `name` | text | Display label (default `Session`) |
| `status` | text | `open` \| `closed` |
| `is_selected` | boolean | At most one `true` (partial unique index) |
| `created_at` / `updated_at` / `last_active_at` | timestamptz | Activity tracking |
| `closed_at` | timestamptz nullable | Set on close |
| `metadata` | jsonb | Extensibility |

Indexes: status+activity, open-by-created, unique selected.

### `terminal_command_history` (included — justified)

Arrow-up history is React-only today and is lost on refresh. Multi-session needs **per-session** recall independent of `discovery_jobs` rows (slash commands, rejected input, `/sources`, etc. are not jobs).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid FK → `terminal_sessions` | `on delete cascade` |
| `command` | text | Truncated to 2000 chars in repository |
| `sequence` | int | Monotonic per session |
| `created_at` | timestamptz | |

Unique `(session_id, sequence)`.

### `discovery_jobs.terminal_session_id`

Nullable FK → `terminal_sessions(id)` `on delete set null`. Legacy / API-created jobs may omit it. Index on `(terminal_session_id, created_at desc)` where not null.

### RLS

RLS enabled on new tables; no anon/authenticated policies (service-role only), matching 006.

## Apply / rollback notes

**Do not apply** until explicitly approved.

Apply order: 006 → 007.

After apply:

1. Regenerate `database.types` from Supabase.
2. Prefer `TERMINAL_SESSION_STORE=supabase` (or rely on Supabase env auto-detect).
3. Wire job enqueue to call `linkJob(sessionId, jobId)` (out of scope for this proposal).

Rollback sketch (manual): drop FK column, then history + sessions tables.

```sql
alter table public.discovery_jobs drop column if exists terminal_session_id;
drop table if exists public.terminal_command_history;
drop table if exists public.terminal_sessions;
```

## Repository API surface

Resolver: `getTerminalSessionStore()` in `src/server/terminal/store.ts`.

| Method | Behavior |
|---|---|
| `listSessions({ includeClosed?, limit? })` | Open sessions by default; newest activity first |
| `getSession(id)` | Single session or null |
| `getSelectedSession()` | Open + selected, or null |
| `createSession({ name?, select?, metadata? })` | Creates open session; `select` defaults true |
| `renameSession(id, name)` | Updates display name |
| `closeSession(id)` | Marks closed, clears selection |
| `selectSession(id)` | Sole selected open session |
| `touchSession(id)` | Bumps `last_active_at` |
| `linkJob(sessionId, jobId)` | Sets `discovery_jobs.terminal_session_id` (memory: in-process map) |
| `listSessionJobIds(sessionId, { limit? })` | Job ids for a session |
| `appendCommandHistory(sessionId, command)` | Append next sequence |
| `listCommandHistory(sessionId, { limit? })` | Chronological entries |

### Store selection

| Condition | Store |
|---|---|
| `TERMINAL_SESSION_STORE=memory` | DEV-ONLY memory (blocked in production unless `TERMINAL_ALLOW_MEMORY_STORE=true`) |
| `TERMINAL_SESSION_STORE=supabase` or Supabase configured | Supabase |
| Production without Supabase | **Throws** with apply-007 guidance |
| Local without Supabase | DEV-ONLY memory (console info banner) |

Client helpers: `src/lib/terminal/sessions.ts` (types + sort/select/history helpers). No HTTP routes in this proposal — API routes are a follow-up.

## Related env knobs (`.env.example`)

| Var | Default | Role |
|---|---|---|
| `DISCOVERY_MAX_ACTIVE_JOBS` | `1` | Concurrent running/active jobs |
| `DISCOVERY_MAX_QUEUED_JOBS` | `8` | Queued backlog cap (wire in enqueue/config follow-up) |
| `DISCOVERY_JOB_TIMEOUT_MS` | `600000` | Job timeout |
| `DISCOVERY_EVENT_RETENTION_DAYS` | `14` | Event retention for cleanup workers |

Optional store overrides (same pattern as discovery jobs):

- `TERMINAL_SESSION_STORE=memory\|supabase`
- `TERMINAL_ALLOW_MEMORY_STORE=true` (emergency only)

## Out of scope

- Applying the migration
- DiscoveryTerminal UI / session tabs
- HTTP `/api/terminal/sessions` routes
- Wiring `DISCOVERY_MAX_QUEUED_JOBS` into `readDiscoveryRuntimeConfig` / enqueue
- Regenerating Supabase TypeScript types
