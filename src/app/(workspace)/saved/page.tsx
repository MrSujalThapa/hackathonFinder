import { HistoryView } from "@/components/history/HistoryView";

export default function SavedPage() {
  return (
    <HistoryView
      status="SAVED_FOR_LATER"
      title="Saved"
      description="Candidates parked for later review."
      emptyTitle="Nothing saved yet"
      emptyDescription="Use Save while reviewing to park a candidate without deciding."
      allowRestore
    />
  );
}
