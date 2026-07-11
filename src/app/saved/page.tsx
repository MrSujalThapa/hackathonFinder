import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default function SavedPage() {
  return (
    <section>
      <PageHeader
        eyebrow="History"
        title="Saved"
        description="Candidates parked for later review."
      />
      <EmptyState
        title="Nothing saved yet"
        description="Use Save while reviewing to park a candidate without deciding."
      />
    </section>
  );
}
