-- Pass 2 notification types. Apply through the normal Supabase migration workflow.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in ('APPLICATION_OPEN','APPLICATION_NEEDS_INPUT','APPLICATION_NEEDS_FILE','APPLICATION_AUTH_REQUIRED','APPLICATION_READY_TO_SUBMIT','APPLICATION_READY_FOR_REVIEW','DEADLINE_SOON','SUBMISSION_FAILED'));
