-- Production RLS hardening for the private owner-only deployment.
--
-- Apply manually after confirming the web app routes use the Next.js API layer
-- and the service-role key is present only on the server.
--
-- This migration intentionally creates no anon/authenticated policies. With RLS
-- enabled and no matching policies, direct browser/anon table access is denied.
-- Supabase service-role requests from server code continue to bypass RLS.

begin;

alter table if exists public.candidates enable row level security;
alter table if exists public.candidate_evidence enable row level security;
alter table if exists public.candidate_answers enable row level security;
alter table if exists public.candidate_actions enable row level security;
alter table if exists public.agent_runs enable row level security;
alter table if exists public.manual_leads enable row level security;

drop policy if exists "allow anon read candidates" on public.candidates;
drop policy if exists "allow anon write candidates" on public.candidates;
drop policy if exists "allow authenticated read candidates" on public.candidates;
drop policy if exists "allow authenticated write candidates" on public.candidates;

drop policy if exists "allow anon read candidate_evidence" on public.candidate_evidence;
drop policy if exists "allow anon write candidate_evidence" on public.candidate_evidence;
drop policy if exists "allow authenticated read candidate_evidence" on public.candidate_evidence;
drop policy if exists "allow authenticated write candidate_evidence" on public.candidate_evidence;

drop policy if exists "allow anon read candidate_answers" on public.candidate_answers;
drop policy if exists "allow anon write candidate_answers" on public.candidate_answers;
drop policy if exists "allow authenticated read candidate_answers" on public.candidate_answers;
drop policy if exists "allow authenticated write candidate_answers" on public.candidate_answers;

drop policy if exists "allow anon read candidate_actions" on public.candidate_actions;
drop policy if exists "allow anon write candidate_actions" on public.candidate_actions;
drop policy if exists "allow authenticated read candidate_actions" on public.candidate_actions;
drop policy if exists "allow authenticated write candidate_actions" on public.candidate_actions;

drop policy if exists "allow anon read agent_runs" on public.agent_runs;
drop policy if exists "allow anon write agent_runs" on public.agent_runs;
drop policy if exists "allow authenticated read agent_runs" on public.agent_runs;
drop policy if exists "allow authenticated write agent_runs" on public.agent_runs;

drop policy if exists "allow anon read manual_leads" on public.manual_leads;
drop policy if exists "allow anon write manual_leads" on public.manual_leads;
drop policy if exists "allow authenticated read manual_leads" on public.manual_leads;
drop policy if exists "allow authenticated write manual_leads" on public.manual_leads;

commit;
