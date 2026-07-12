import { CandidateDetailView } from "@/components/candidates/CandidateDetailView";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CandidateDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <CandidateDetailView id={id} />;
}
