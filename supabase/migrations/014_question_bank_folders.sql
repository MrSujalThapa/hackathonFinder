-- Durable folders replace the legacy convention that used the first question tag as a folder.
create table if not exists question_bank_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  color text not null default 'blue',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists idx_question_bank_folders_owner on question_bank_folders(user_id, name);

alter table question_bank add column if not exists folder_id uuid references question_bank_folders(id) on delete set null;
create index if not exists idx_question_bank_folder on question_bank(folder_id);

-- Seed the original explorer folders for the private owner. Existing questions remain valid;
-- they can be moved explicitly from the UI after this migration.
insert into question_bank_folders (user_id, name, color)
values
  ('00000000-0000-0000-0000-000000000001', 'Career', 'blue'),
  ('00000000-0000-0000-0000-000000000001', 'Personal', 'teal'),
  ('00000000-0000-0000-0000-000000000001', 'Fun', 'purple'),
  ('00000000-0000-0000-0000-000000000001', 'Hackathons', 'amber'),
  ('00000000-0000-0000-0000-000000000001', 'Startup', 'rose'),
  ('00000000-0000-0000-0000-000000000001', 'Technical', 'indigo')
on conflict (user_id, name) do nothing;

update question_bank q set folder_id = f.id
from question_bank_folders f
where q.folder_id is null and q.user_id = f.user_id and lower(coalesce(q.tags[1], '')) = lower(f.name);
