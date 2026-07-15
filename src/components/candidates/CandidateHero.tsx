import type { CandidateCard } from "@/core/candidates/types";
import { formatSourceLabel } from "@/lib/candidates/format";
import { StatusStamp } from "@/components/blueprint/StatusStamp";
import { SourceStamp } from "@/components/blueprint/SourceStamp";

/** Quiet status strip — drafting stamps, no decorative gradient hero. */
export function CandidateHero({
  candidate,
  sourceLabels = {},
}: {
  candidate: CandidateCard;
  sourceLabels?: Record<string, string>;
}) {
  const needsReview = candidate.status === "NEEDS_REVIEW";
  const uniqueSourceIds = [
    ...new Set([
      candidate.source,
      ...Object.keys(candidate.sourceIds ?? {}),
    ].filter(Boolean)),
  ];
  return (
    <div className="border-b border-border-subtle px-5 pb-3 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusStamp tone={needsReview ? "warn" : "default"}>
          {needsReview ? "Needs review" : candidate.status.replaceAll("_", " ")}
        </StatusStamp>
        {uniqueSourceIds.map((source) => (
          <SourceStamp key={source}>
            {sourceLabels[source] ?? formatSourceLabel(source)}
          </SourceStamp>
        ))}
      </div>
    </div>
  );
}
