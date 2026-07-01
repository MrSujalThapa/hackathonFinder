# Database Schema — Supabase/Postgres

## 1. Design Goals

- Prevent duplicates.
- Keep every candidate, including rejected ones.
- Preserve source evidence.
- Support fast mobile queue reads.
- Support follow-up enrichment answers.
- Support auditability through action logs.

## 2. Tables

## 2.1 `candidates`

```sql
create extension if not exists pgcrypto;

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
```

## 2.2 `candidate_evidence`

```sql
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
```

## 2.3 `candidate_answers`

Stores answers from “Find more info.”

```sql
create table if not exists candidate_answers (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,

  question text not null,
  answer text not null,
  confidence text check (confidence in ('low', 'medium', 'high') or confidence is null),
  sources jsonb not null default '[]',

  created_at timestamptz not null default now()
);
```

## 2.4 `candidate_actions`

Audit log for approvals/rejections/saves/restores.

```sql
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
```

## 2.5 `agent_runs`

Stores discovery run summaries.

```sql
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
```

## 2.6 `manual_leads`

```sql
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

  unique(url)
);
```

## 3. Indexes

```sql
create index if not exists idx_candidates_status_score
  on candidates(status, score desc, found_at desc);

create index if not exists idx_candidates_deadline
  on candidates(deadline);

create index if not exists idx_candidates_start_date
  on candidates(start_date);

create index if not exists idx_candidates_official_url
  on candidates(official_url)
  where official_url is not null;

create index if not exists idx_candidates_apply_url
  on candidates(apply_url)
  where apply_url is not null;

create index if not exists idx_candidates_social_url
  on candidates(social_url)
  where social_url is not null;

create index if not exists idx_candidate_evidence_candidate_id
  on candidate_evidence(candidate_id);

create index if not exists idx_candidate_actions_candidate_id
  on candidate_actions(candidate_id, created_at desc);

create index if not exists idx_manual_leads_status
  on manual_leads(status, created_at desc);
```

## 4. Updated At Trigger

```sql
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_candidates_updated_at
before update on candidates
for each row
execute function set_updated_at();
```

## 5. Dedupe Strategy

## 5.1 Fingerprint Generation

In TypeScript:

```ts
function normalizeText(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/www\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return normalizeText(value);
  }
}

function candidateFingerprint(input: {
  name: string;
  officialUrl?: string | null;
  applyUrl?: string | null;
  socialUrl?: string | null;
  city?: string | null;
  country?: string | null;
  startDate?: string | null;
  deadline?: string | null;
}) {
  const official = normalizeUrl(input.officialUrl);
  if (official) return `official:${official}`;

  const apply = normalizeUrl(input.applyUrl);
  if (apply) return `apply:${apply}`;

  const social = normalizeUrl(input.socialUrl);
  if (social) return `social:${social}`;

  const name = normalizeText(input.name);
  const place = normalizeText([input.city, input.country].filter(Boolean).join(" "));
  const date = input.startDate ?? input.deadline ?? "unknown-date";

  return `event:${name}:${place}:${date}`;
}
```

## 5.2 Upsert Behavior

If fingerprint already exists:

- update missing fields
- merge themes
- merge why/red flags
- insert new evidence
- add `UPDATE_FROM_DUPLICATE` action
- do not create a new candidate

## 6. Row-Level Security Notes

For MVP, this can be a personal project with server-side service role access only. If deploying publicly:

- Enable RLS on all tables.
- Require auth.
- Scope rows by `user_id`.
- Never expose service role key to client.

Post-MVP user-owned schema addition:

```sql
alter table candidates add column user_id uuid;
alter table manual_leads add column user_id uuid;
alter table agent_runs add column user_id uuid;
```
