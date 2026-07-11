import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default function QueuePage() {
  return (
    <section className="flex flex-1 flex-col items-center">
      <div className="w-full max-w-[440px]">
        <PageHeader
          eyebrow="Review"
          title="Queue"
          description="One candidate at a time. Approve, reject, or save for later."
        />
        <EmptyState
          title="Queue shell ready"
          description="Candidate cards and swipe interactions arrive in the next steps."
          hint={'npm run agent -- "find upcoming hackathons" -- --sources=mock --dry-run'}
        />
      </div>
    </section>
  );
}
