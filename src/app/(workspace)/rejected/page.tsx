import { HistoryView } from "@/components/history/HistoryView";

export default function RejectedPage() {
  return (
    <HistoryView
      status="REJECTED"
      title="Rejected"
      description="Rejected candidates stay recoverable. Nothing is deleted."
      emptyTitle="No rejected candidates"
      emptyDescription="Items you reject remain here so you can restore them later."
      allowRestore
    />
  );
}
