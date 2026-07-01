-- Hackathon Approval Agent — initial candidate queue schema

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- candidates
-- ---------------------------------------------------------------------------

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),

  status text not null default 'NEW' check (
    status in (
      'NEW',
      'NEEDS_REVIEW',
      'APPROVED',
      'REJECTED',
      'SAVED_FOR_LATER',
      'EXPIRED',
      'DUPLICATE',
      'ERROR'
    )
  ),

  score int not null default 0,

  name text not null,
  source text not null,

  official_url text,
  apply_url text,
  social_url text,

  start_date date,
  end_date date,
  deadline date,

  location text,
  mode text check (mode in ('online', 'in-person', 'hybrid', 'unknown') or mode is null),
  city text,
  country text,

  prize text,
  themes text[] not null default '{}',
  eligibility text,
  description text,
  summary text,

  why_match text[] not null default '{}',
  red_flags text[] not null default '{}',

  fingerprint text not null,
  source_ids jsonb not null default '{}',

  sheet_row_id text,
  sheet_appended_at timestamptz,

  found_at timestamptz not null default now(),
  last_verified timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  saved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (fingerprint)
);

-- ---------------------------------------------------------------------------
-- candidate_evidence
-- ---------------------------------------------------------------------------

create table if not exists candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,

  type text not null check (
    type in (
      'official_page',
      'apply_page',
      'x_post',
      'manual_lead',
      'search_result',
      'source_card',
      'luma_page',
      'devpost_page',
      'mlh_page',
      'hacklist_card',
      'hakku_card'
    )
  ),

  url text,
  title text,
  snippet text,
  raw jsonb not null default '{}',

  found_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- candidate_answers
-- ---------------------------------------------------------------------------

create table if not exists candidate_answers (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,

  question text not null,
  answer text not null,
  confidence text check (confidence in ('low', 'medium', 'high') or confidence is null),
  sources jsonb not null default '[]',

  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- candidate_actions
-- ---------------------------------------------------------------------------

create table if not exists candidate_actions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,

  action text not null check (
    action in (
      'APPROVE',
      'REJECT',
      'SAVE_FOR_LATER',
      'RESTORE',
      'ENRICH',
      'UPDATE_FROM_DUPLICATE',
      'SHEET_APPEND',
      'UNDO'
    )
  ),

  previous_status text,
  new_status text,
  reason text,
  metadata jsonb not null default '{}',

  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- agent_runs
-- ---------------------------------------------------------------------------

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),

  command text not null,
  preferences jsonb not null default '{}',
  sources text[] not null default '{}',

  status text not null default 'STARTED' check (
    status in ('STARTED', 'COMPLETED', 'FAILED', 'PARTIAL')
  ),

  raw_leads_count int not null default 0,
  parsed_events_count int not null default 0,
  new_candidates_count int not null default 0,
  updated_candidates_count int not null default 0,
  rejected_count int not null default 0,
  errors jsonb not null default '[]',

  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ---------------------------------------------------------------------------
-- manual_leads
-- ---------------------------------------------------------------------------

create table if not exists manual_leads (
  id uuid primary key default gen_random_uuid(),

  platform text not null check (
    platform in ('X', 'Instagram', 'LinkedIn', 'Discord', 'Website', 'Other')
  ),

  url text not null,
  notes text,

  status text not null default 'UNPROCESSED' check (
    status in ('UNPROCESSED', 'PROCESSED', 'REJECTED', 'NEEDS_REVIEW')
  ),

  candidate_id uuid references candidates(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),

  unique (url)
);

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------

create index if not exists idx_candidates_status_score
  on candidates (status, score desc, found_at desc);

create index if not exists idx_candidates_status
  on candidates (status);

create index if not exists idx_candidates_source
  on candidates (source);

create index if not exists idx_candidates_deadline
  on candidates (deadline);

create index if not exists idx_candidates_start_date
  on candidates (start_date);

create index if not exists idx_candidates_created_at
  on candidates (created_at desc);

create index if not exists idx_candidates_official_url
  on candidates (official_url)
  where official_url is not null;

create index if not exists idx_candidates_apply_url
  on candidates (apply_url)
  where apply_url is not null;

create index if not exists idx_candidates_social_url
  on candidates (social_url)
  where social_url is not null;

create index if not exists idx_candidate_evidence_candidate_id
  on candidate_evidence (candidate_id);

create index if not exists idx_candidate_actions_candidate_id
  on candidate_actions (candidate_id, created_at desc);

create index if not exists idx_manual_leads_status
  on manual_leads (status, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_candidates_updated_at on candidates;

create trigger trg_candidates_updated_at
before update on candidates
for each row
execute function set_updated_at();
