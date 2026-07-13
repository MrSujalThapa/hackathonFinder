-- Terminal sessions + job linkage (proposal - DO NOT APPLY without explicit approval)
--
-- Enables multi-session discovery terminal persistence across refresh/navigation.
-- Depends on migration 006_discovery_jobs.sql (discovery_jobs table).
-- RLS enabled with no anon/authenticated policies (service-role only).

begin;

-- ---------------------------------------------------------------------------
-- terminal_sessions
-- ---------------------------------------------------------------------------

create table if not exists public.terminal_sessions (
  id uuid primary key default gen_random_uuid(),

  title text not null default 'Session',
  status text not null default 'open' check (status in ('open', 'closed')),

  active_job_id uuid references public.discovery_jobs(id) on delete set null,
  selected_job_id uuid references public.discovery_jobs(id) on delete set null,

  -- At most one selected session (enforced by partial unique index below).
  is_selected boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  last_selected_at timestamptz,
  sort_order int not null default 0,

  -- Bounded metadata only; no output buffers, cookies, credentials, or storage state.
  metadata jsonb not null default '{}'::jsonb,
  constraint terminal_sessions_metadata_object_chk
    check (jsonb_typeof(metadata) = 'object'),
  constraint terminal_sessions_metadata_size_chk
    check (pg_column_size(metadata) <= 4096)
);

create index if not exists terminal_sessions_status_sort_idx
  on public.terminal_sessions (status, sort_order, last_selected_at desc);

create index if not exists terminal_sessions_open_selected_idx
  on public.terminal_sessions (last_selected_at desc)
  where status = 'open';

create index if not exists terminal_sessions_active_job_idx
  on public.terminal_sessions (active_job_id)
  where active_job_id is not null;

create index if not exists terminal_sessions_selected_job_idx
  on public.terminal_sessions (selected_job_id)
  where selected_job_id is not null;

-- Exactly zero or one selected session at a time.
create unique index if not exists terminal_sessions_one_selected_idx
  on public.terminal_sessions (is_selected)
  where is_selected = true;

-- ---------------------------------------------------------------------------
-- Per-session command recall (arrow-up history). Optional but justified:
-- UI history is currently React-only and lost on refresh; multi-session
-- needs durable, per-session recall independent of job rows.
-- ---------------------------------------------------------------------------

create table if not exists public.terminal_command_history (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.terminal_sessions(id) on delete cascade,

  command text not null,
  sequence int not null,
  created_at timestamptz not null default now(),

  unique (session_id, sequence)
);

create index if not exists terminal_command_history_session_seq_idx
  on public.terminal_command_history (session_id, sequence desc);

-- ---------------------------------------------------------------------------
-- Link discovery jobs to a terminal session (nullable for legacy / API jobs)
-- ---------------------------------------------------------------------------

alter table public.discovery_jobs
  add column if not exists terminal_session_id uuid
    references public.terminal_sessions(id) on delete set null;

create index if not exists discovery_jobs_terminal_session_idx
  on public.discovery_jobs (terminal_session_id, created_at desc)
  where terminal_session_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: no public anon access (service-role bypasses RLS)
-- ---------------------------------------------------------------------------

alter table public.terminal_sessions enable row level security;
alter table public.terminal_command_history enable row level security;

-- Intentionally no policies for anon/authenticated roles.

commit;
