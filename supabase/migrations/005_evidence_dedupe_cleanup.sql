-- One-time cleanup: consolidate duplicate candidate_evidence rows.
-- Prefer running scripts/cleanup-duplicate-evidence.ts which uses the same
-- normalizeEvidenceUrlKey() as the application.
--
-- This SQL is a conservative fallback when Node cleanup is unavailable.
-- It groups by (candidate_id, type, lower(trim trailing slash / fragment)).
-- Review counts before deleting.

with keyed as (
  select
    id,
    candidate_id,
    type,
    lower(
      regexp_replace(
        regexp_replace(coalesce(url, ''), '#.*$', ''),
        '/+$',
        ''
      )
    ) as provisional_key,
    coalesce(first_seen_at, found_at, created_at) as first_seen,
    coalesce(last_seen_at, found_at, created_at) as last_seen,
    coalesce(seen_count, 1) as seen_count,
    created_at
  from public.candidate_evidence
),
ranked as (
  select
    *,
    row_number() over (
      partition by candidate_id, type, provisional_key
      order by first_seen asc, created_at asc, id asc
    ) as rn,
    min(first_seen) over (partition by candidate_id, type, provisional_key) as keep_first,
    max(last_seen) over (partition by candidate_id, type, provisional_key) as keep_last,
    sum(seen_count) over (partition by candidate_id, type, provisional_key) as keep_seen
  from keyed
),
updated as (
  update public.candidate_evidence e
  set
    url_key = r.provisional_key,
    first_seen_at = r.keep_first,
    last_seen_at = r.keep_last,
    seen_count = r.keep_seen::integer
  from ranked r
  where e.id = r.id and r.rn = 1
  returning e.id
)
delete from public.candidate_evidence e
using ranked r
where e.id = r.id and r.rn > 1;
