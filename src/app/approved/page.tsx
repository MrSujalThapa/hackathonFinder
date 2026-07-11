import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default function ApprovedPage() {
  return (
    <section>
      <PageHeader
        eyebrow="History"
        title="Approved"
        description="Candidates you approved. Google Sheets sync arrives in a later step."
      />
      <EmptyState
        title="No approved candidates yet"
        description="Approved hackathons will appear here after you review the queue."
      />
    </section>
  );
}
