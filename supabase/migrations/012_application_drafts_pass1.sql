-- Pass 1 durable application drafts. Apply through the normal Supabase migration workflow.
alter table applications add column if not exists current_page integer;
alter table applications add column if not exists total_pages integer;
alter table applications add column if not exists checkpoint jsonb not null default '{}';
alter table applications drop constraint if exists applications_status_check;
alter table applications add constraint applications_status_check check (status in ('not_started','scheduled','drafting','auth_required','needs_input','needs_file','paused','ready_to_submit','user_managed','ready_for_review','approved','submitting','submitted','failed'));
alter table application_questions drop constraint if exists application_questions_answer_source_check;
alter table application_questions add constraint application_questions_answer_source_check check (answer_source in ('profile','question_bank','asset_bank','ai','user','unresolved'));

create table if not exists asset_bank (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  label text not null, kind text not null check (kind in ('file','link')),
  asset_type text not null, value text not null, filename text,
  notes text, is_default boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists idx_asset_bank_owner_type on asset_bank(user_id, asset_type);

-- A dedupe key permits a new notification when a later page introduces a new blocker batch.
alter table notifications add column if not exists dedupe_key text not null default 'legacy';
alter table notifications drop constraint if exists notifications_candidate_id_application_id_type_key;
create unique index if not exists notifications_dedupe_key on notifications(application_id, type, dedupe_key) where application_id is not null;
