export type SheetSyncStatus =
  | "appended"
  | "already_synced"
  | "recovered_existing_row"
  | "skipped_not_approved"
  | "failed"
  | "skipped_not_configured"
  | "mock_synced"
  | "dry_run";

export type SheetSyncResult = {
  status: SheetSyncStatus;
  rowId?: string | null;
  message?: string;
  candidateId: string;
};

export type BatchSyncSummary = {
  checked: number;
  appended: number;
  already_synced: number;
  recovered: number;
  skipped: number;
  failed: number;
  mock_synced: number;
  dry_run: number;
  results: SheetSyncResult[];
};
