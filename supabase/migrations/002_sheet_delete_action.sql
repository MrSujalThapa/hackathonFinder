-- Add SHEET_DELETE to candidate_actions.action check (non-destructive).
-- Drops and recreates the check constraint to include the new value.

alter table candidate_actions
  drop constraint if exists candidate_actions_action_check;

alter table candidate_actions
  add constraint candidate_actions_action_check
  check (
    action in (
      'APPROVE',
      'REJECT',
      'SAVE_FOR_LATER',
      'RESTORE',
      'ENRICH',
      'UPDATE_FROM_DUPLICATE',
      'SHEET_APPEND',
      'SHEET_DELETE',
      'UNDO'
    )
  );
