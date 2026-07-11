import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CandidateDetailPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <section>
      <PageHeader
        eyebrow="Candidate"
        title="Details"
        description={`Candidate ${id}`}
      />
      <EmptyState
        title="Detail view coming next"
        description="Full evidence, action history, and status controls land with the review card."
      />
    </section>
  );
}
