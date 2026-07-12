-- Phase 10.1: idempotent candidate evidence identity
-- Do NOT apply automatically in agent workflows; review first.

alter table public.candidate_evidence
  add column if not exists url_key text not null default '',
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists seen_count integer not null default 1,
  add column if not exists agent_run_id uuid references public.agent_runs(id) on delete set null;

-- Backfill timestamps from existing found_at / created_at
update public.candidate_evidence
set
  first_seen_at = coalesce(first_seen_at, found_at, created_at, now()),
  last_seen_at = coalesce(last_seen_at, found_at, created_at, now())
where first_seen_at is null or last_seen_at is null;

alter table public.candidate_evidence
  alter column first_seen_at set default now(),
  alter column last_seen_at set default now();

alter table public.candidate_evidence
  alter column first_seen_at set not null,
  alter column last_seen_at set not null;

-- Provisional url_key backfill (app + cleanup script refine tracking-param stripping)
update public.candidate_evidence
set url_key = lower(
  regexp_replace(
    regexp_replace(coalesce(url, ''), '#.*$', ''),
    '/+$',
    ''
  )
)
where url_key = '' and url is not null;

create unique index if not exists uq_candidate_evidence_identity
  on public.candidate_evidence (candidate_id, type, url_key);

create index if not exists idx_candidate_evidence_last_seen
  on public.candidate_evidence (candidate_id, last_seen_at desc);
