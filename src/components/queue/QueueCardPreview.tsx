"use client";

import { useState } from "react";
import { CandidateCardView } from "@/components/candidates/CandidateCard";
import { CandidateProgress } from "@/components/candidates/CandidateProgress";
import { PageHeader } from "@/components/shell/PageHeader";
import { PREVIEW_CANDIDATE } from "@/lib/candidates/preview";

export function QueueCardPreview() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="flex flex-1 flex-col items-center">
      <div className="w-full max-w-[440px]">
        <PageHeader
          eyebrow="Review"
          title="Queue"
          description="One candidate at a time. Approve, reject, or save for later."
        />
        <CandidateProgress current={1} total={1} />
        <div className="flex justify-center">
          <CandidateCardView
            candidate={PREVIEW_CANDIDATE}
            expanded={expanded}
            onToggleDetails={() => setExpanded((value) => !value)}
            onApprove={() => undefined}
            onReject={() => undefined}
            onSave={() => undefined}
          />
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Preview card — live queue wiring arrives with interactions.
        </p>
      </div>
    </section>
  );
}
