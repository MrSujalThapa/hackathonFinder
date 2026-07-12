"use client";

import { useMemo, useState } from "react";
import type { CandidateEvidence } from "@/core/candidates/types";
import {
  evidenceTypeLabel,
  groupCandidateEvidence,
  selectPrimaryEvidenceGroups,
} from "@/lib/candidates/evidenceGroups";
import { useExpandMotion } from "@/lib/ui/useExpandMotion";

const PRIMARY_LIMIT = 5;

function typeTone(type: string): string {
  switch (type) {
    case "official_page":
      return "border-l-emerald-400/70";
    case "apply_page":
      return "border-l-sky-400/70";
    case "directory":
      return "border-l-slate-400/60";
    case "social":
      return "border-l-violet-400/50";
    case "article":
      return "border-l-amber-400/55";
    default:
      return "border-l-border";
  }
}

export function CandidateEvidencePanel({
  evidence,
}: {
  evidence: CandidateEvidence[];
}) {
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(() => groupCandidateEvidence(evidence), [evidence]);
  const { primary, rest } = useMemo(
    () => selectPrimaryEvidenceGroups(groups, PRIMARY_LIMIT),
    [groups],
  );
  const expandRef = useExpandMotion(showAll && rest.length > 0);

  if (evidence.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="hf-section-label">Sources</h2>
        <p className="text-xs text-muted">
          {groups.length} unique · {evidence.length} records
        </p>
      </div>
      <ul className="space-y-2">
        {primary.map((group) => (
          <EvidenceCard key={group.key} group={group} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <>
          <div
            ref={expandRef}
            className="hf-expand"
            aria-hidden={!showAll}
            inert={!showAll || undefined}
          >
            <ul className="space-y-2 pt-1">
              {rest.map((group) => (
                <EvidenceCard key={group.key} group={group} />
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="hf-link-quiet"
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll
              ? "Show fewer sources"
              : `Show all ${groups.length} sources`}
          </button>
        </>
      ) : null}
    </section>
  );
}

function EvidenceCard({
  group,
}: {
  group: ReturnType<typeof groupCandidateEvidence>[number];
}) {
  return (
    <li
      className={`hf-panel border-l-2 px-3 py-3 ${typeTone(group.type)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {evidenceTypeLabel(group.type)}
            {group.domain ? ` · ${group.domain}` : ""}
          </p>
          <p className="mt-1 text-sm text-foreground">{group.title}</p>
          <p className="mt-1 text-xs text-muted">
            Authority {group.authority}
            {" · "}
            Verified {new Date(group.lastVerified).toLocaleDateString()}
            {group.seenCount > 1 ? ` · Seen ${group.seenCount}×` : null}
          </p>
        </div>
        {group.url ? (
          <a
            href={group.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hf-btn hf-btn-ghost shrink-0 !min-h-0 px-2.5 py-1.5 text-xs text-sky-200"
            aria-label={`Open ${evidenceTypeLabel(group.type)} source${group.domain ? ` on ${group.domain}` : ""}`}
          >
            Open source
          </a>
        ) : null}
      </div>
    </li>
  );
}
