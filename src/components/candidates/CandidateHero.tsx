import type { CandidateCard } from "@/core/candidates/types";
import { formatSourceLabel } from "@/lib/candidates/format";

/** Quiet status strip — no decorative gradient hero. */
export function CandidateHero({ candidate }: { candidate: CandidateCard }) {
  const needsReview = candidate.status === "NEEDS_REVIEW";
  return (
    <div className="border-b border-border-subtle px-5 pb-3 pt-4">
      <p
        className={[
          "text-[11px] font-medium uppercase tracking-[0.12em]",
          needsReview ? "text-amber-200/90" : "text-sky-200/80",
        ].join(" ")}
      >
        {needsReview ? "Needs review" : candidate.status.replaceAll("_", " ")}
        {" · "}
        {formatSourceLabel(candidate.source)}
      </p>
    </div>
  );
}
