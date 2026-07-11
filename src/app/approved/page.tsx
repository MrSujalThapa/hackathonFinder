import { HistoryView } from "@/components/history/HistoryView";

export default function ApprovedPage() {
  return (
    <HistoryView
      status="APPROVED"
      title="Approved"
      description="Candidates you approved. Google Sheets sync arrives in a later step."
      emptyTitle="No approved candidates yet"
      emptyDescription="Approved hackathons will appear here after you review the queue."
    />
  );
}
