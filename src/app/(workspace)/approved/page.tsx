import { HistoryView } from "@/components/history/HistoryView";

export default function ApprovedPage() {
  return (
    <HistoryView
      status="APPROVED"
      title="Approved"
      description="Candidates you approved. Sheet sync status shows on each card — retry if pending or failed."
      emptyTitle="No approved candidates yet"
      emptyDescription="Approved hackathons will appear here after you review the queue."
    />
  );
}
