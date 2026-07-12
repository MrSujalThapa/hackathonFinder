"use client";

import { useMemo, useState } from "react";
import type { CandidateEvidence } from "@/core/candidates/types";
import {
  evidenceTypeLabel,
  groupCandidateEvidence,
  selectPrimaryEvidenceGroups,
} from "@/lib/candidates/evidenceGroups";

const PRIMARY_LIMIT = 5;

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
  const visible = showAll ? [...primary, ...rest] : primary;

  if (evidence.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
          Sources
        </h2>
        <p className="text-xs text-muted">
          {groups.length} unique · {evidence.length} records
        </p>
      </div>
      <ul className="space-y-2">
        {visible.map((group) => (
          <li
            key={group.key}
            className="rounded-xl border border-border/70 bg-black/20 px-3 py-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {evidenceTypeLabel(group.type)}
                  {group.domain ? ` · ${group.domain}` : ""}
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {group.title}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Authority {group.authority}
                  {" · "}
                  Verified {new Date(group.lastVerified).toLocaleDateString()}
                  {group.seenCount > 1
                    ? ` · Seen ${group.seenCount}×`
                    : null}
                </p>
              </div>
              {group.url ? (
                <a
                  href={group.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs text-sky-200 transition-colors hover:border-sky-500/40 hover:text-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                  aria-label={`Open ${evidenceTypeLabel(group.type)} source${group.domain ? ` on ${group.domain}` : ""}`}
                >
                  Open source
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {rest.length > 0 ? (
        <button
          type="button"
          className="text-xs text-sky-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show fewer sources" : `Show all ${groups.length} sources`}
        </button>
      ) : null}
    </section>
  );
}
