alter table agent_runs
add column if not exists metadata jsonb not null default '{}';
