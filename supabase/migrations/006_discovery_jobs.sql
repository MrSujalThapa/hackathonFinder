-- Discovery jobs + events (proposal — DO NOT APPLY without explicit approval)
--
-- Supports web terminal discovery runs and future worker polling.
-- RLS enabled with no anon/authenticated policies (service-role only).

begin;

-- ---------------------------------------------------------------------------
-- discovery_jobs
-- ---------------------------------------------------------------------------

create table if not exists public.discovery_jobs (
  id uuid primary key default gen_random_uuid(),

  command text not null,
  status text not null default 'queued' check (
    status in (
      'queued',
      'planning',
      'collecting',
      'enriching',
      'verifying',
      'persisting',
      'completed',
      'failed',
      'cancelled'
    )
  ),

  requested_sources text[] not null default '{}',
  effective_sources text[] not null default '{}',
  mode text not null default 'auto' check (
    mode in ('auto', 'agent', 'deterministic')
  ),
  dry_run boolean not null default false,
  all_sources boolean not null default false,
  max_agent_calls int,

  progress int not null default 0 check (progress >= 0 and progress <= 100),
  current_stage text,

  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,

  failure_category text,
  safe_error_message text,
  agent_run_id uuid references public.agent_runs(id) on delete set null,

  created_count int not null default 0,
  updated_count int not null default 0,
  accepted_count int not null default 0,
  rejected_count int not null default 0,
  needs_review_count int not null default 0,
  raw_leads_count int not null default 0,
  duration_ms int,

  -- Retry-safe worker claim metadata
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  worker_id text,
  cancel_requested boolean not null default false,

  summary jsonb not null default '{}'::jsonb
);

create index if not exists discovery_jobs_status_created_idx
  on public.discovery_jobs (status, created_at desc);

create index if not exists discovery_jobs_active_idx
  on public.discovery_jobs (created_at desc)
  where status in ('queued', 'planning', 'collecting', 'enriching', 'verifying', 'persisting');

create index if not exists discovery_jobs_claim_idx
  on public.discovery_jobs (status, claim_expires_at)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- discovery_job_events
-- ---------------------------------------------------------------------------

create table if not exists public.discovery_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.discovery_jobs(id) on delete cascade,

  sequence int not null,
  event_type text not null,
  level text not null check (level in ('info', 'success', 'warning', 'error')),
  source text,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  unique (job_id, sequence)
);

create index if not exists discovery_job_events_job_seq_idx
  on public.discovery_job_events (job_id, sequence);

create index if not exists discovery_job_events_created_idx
  on public.discovery_job_events (created_at);

-- ---------------------------------------------------------------------------
-- RLS: no public anon access (service-role bypasses RLS)
-- ---------------------------------------------------------------------------

alter table public.discovery_jobs enable row level security;
alter table public.discovery_job_events enable row level security;

-- Intentionally no policies for anon/authenticated roles.

commit;
