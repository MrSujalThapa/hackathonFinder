export type SheetSyncStatus =
  | "appended"
  | "already_synced"
  | "recovered_existing_row"
  | "skipped_not_approved"
  | "failed"
  | "skipped_not_configured"
  | "mock_synced"
  | "dry_run"
  | "deleted"
  | "already_absent"
  | "mock_cleared";

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

/** Bidirectional reconcile: ensure sheet presence matches candidate status. */
export type SheetReconcileStatus =
  | "appended"
  | "already_present"
  | "deleted"
  | "already_absent"
  | "failed"
  | "recovered_existing_row"
  | "mock_synced"
  | "mock_cleared"
  | "skipped_not_configured"
  | "already_synced";

export type SheetReconcileDirection = "ensure_present" | "ensure_absent";

export type SheetReconcileResult = {
  status: SheetReconcileStatus;
  candidateId: string;
  direction: SheetReconcileDirection;
  rowId?: string | null;
  rowNumber?: number | null;
  message?: string;
  metadataCleared?: boolean;
};

export type DeleteRowByCandidateIdResult = {
  status: "deleted" | "already_absent" | "failed";
  candidateId: string;
  rowNumber?: number;
  range?: string;
  message?: string;
};
