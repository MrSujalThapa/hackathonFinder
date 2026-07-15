-- Atomic discovery job event append RPC (proposal — DO NOT APPLY without explicit approval)
--
-- Fixes concurrent event sequence allocation for discovery_job_events while
-- preserving the existing unique constraint on (job_id, sequence).
-- Depends on migration 006_discovery_jobs.sql.

begin;

create or replace function public.append_discovery_job_event(
  p_job_id uuid,
  p_event_type text,
  p_level text,
  p_message text,
  p_id uuid default gen_random_uuid(),
  p_source text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_at timestamptz default now()
)
returns public.discovery_job_events
language plpgsql
security definer
set search_path = public
as $$
declare
  next_sequence int;
  inserted public.discovery_job_events%rowtype;
begin
  -- Transaction-scoped per-job lock: unrelated jobs can append concurrently.
  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text, 0));

  select coalesce(max(sequence), 0) + 1
    into next_sequence
    from public.discovery_job_events
   where job_id = p_job_id;

  insert into public.discovery_job_events (
    id,
    job_id,
    sequence,
    event_type,
    level,
    source,
    message,
    metadata,
    created_at
  )
  values (
    p_id,
    p_job_id,
    next_sequence,
    p_event_type,
    p_level,
    p_source,
    p_message,
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_created_at, now())
  )
  returning * into inserted;

  return inserted;
end;
$$;

revoke all on function public.append_discovery_job_event(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb,
  timestamptz
) from anon, authenticated;

grant execute on function public.append_discovery_job_event(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb,
  timestamptz
) to service_role;

commit;
