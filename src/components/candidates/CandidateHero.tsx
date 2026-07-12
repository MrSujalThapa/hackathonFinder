import type { CandidateCard } from "@/core/candidates/types";
import { formatSourceLabel } from "@/lib/candidates/format";
import { StatusStamp } from "@/components/blueprint/StatusStamp";
import { SourceStamp } from "@/components/blueprint/SourceStamp";

/** Quiet status strip — drafting stamps, no decorative gradient hero. */
export function CandidateHero({ candidate }: { candidate: CandidateCard }) {
  const needsReview = candidate.status === "NEEDS_REVIEW";
  return (
    <div className="border-b border-border-subtle px-5 pb-3 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusStamp tone={needsReview ? "warn" : "default"}>
          {needsReview ? "Needs review" : candidate.status.replaceAll("_", " ")}
        </StatusStamp>
        <SourceStamp>{formatSourceLabel(candidate.source)}</SourceStamp>
      </div>
    </div>
  );
}
