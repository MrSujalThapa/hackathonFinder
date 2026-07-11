import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default function RejectedPage() {
  return (
    <section>
      <PageHeader
        eyebrow="History"
        title="Rejected"
        description="Rejected candidates stay recoverable. Nothing is deleted."
      />
      <EmptyState
        title="No rejected candidates"
        description="Items you reject remain here so you can restore them later."
      />
    </section>
  );
}
