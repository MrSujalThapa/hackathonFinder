"use client";

import type { SheetSyncStatus } from "@/server/sheets/types";

export type SheetSyncBadgeProps = {
  sheetRowId: string | null;
  sheetAppendedAt: string | null;
  status?: SheetSyncStatus | null;
  lastSyncFailed?: boolean;
};

function resolveTone(props: SheetSyncBadgeProps): {
  label: string;
  className: string;
} {
  const isMockRow =
    props.sheetRowId != null &&
    (props.sheetRowId.startsWith("mock:") ||
      props.sheetRowId.startsWith("mock-row:"));

  if (
    props.lastSyncFailed ||
    props.status === "failed"
  ) {
    return {
      label: "Sheet sync failed",
      className:
        "border-rose-500/35 bg-rose-500/10 text-rose-200/90",
    };
  }

  if (props.sheetRowId) {
    if (isMockRow || props.status === "mock_synced") {
      return {
        label: "Mock sheet sync",
        className:
          "border-amber-500/30 bg-amber-500/10 text-amber-100/85",
      };
    }
    return {
      label: "Synced to Sheet",
      className:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-200/85",
    };
  }

  return {
    label: "Sheet sync pending",
    className: "border-border bg-black/20 text-muted",
  };
}

export function SheetSyncBadge(props: SheetSyncBadgeProps) {
  const tone = resolveTone(props);

  return (
    <span
      className={[
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        tone.className,
      ].join(" ")}
      title={
        props.sheetAppendedAt
          ? `Synced ${new Date(props.sheetAppendedAt).toLocaleString()}`
          : undefined
      }
    >
      {tone.label}
    </span>
  );
}

export function needsSheetRetry(props: {
  sheetRowId: string | null;
  lastSyncFailed?: boolean;
  status?: SheetSyncStatus | null;
}): boolean {
  if (props.lastSyncFailed || props.status === "failed") return true;
  return !props.sheetRowId;
}
