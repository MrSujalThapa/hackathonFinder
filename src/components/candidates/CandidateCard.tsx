"use client";

import type { CandidateCard } from "@/core/candidates/types";
import { CandidateActions } from "@/components/candidates/CandidateActions";
import { CandidateEvidenceLinks } from "@/components/candidates/CandidateEvidenceLinks";
import { CandidateHero } from "@/components/candidates/CandidateHero";
import { CandidateMetadata } from "@/components/candidates/CandidateMetadata";
import { CandidateScore } from "@/components/candidates/CandidateScore";
import { CandidateTags } from "@/components/candidates/CandidateTags";
import { getQueueSummary } from "@/lib/candidates/displayContent";
import { formatLocation, hostnameFromUrl } from "@/lib/candidates/format";

type CandidateCardProps = {
  candidate: CandidateCard;
  expanded?: boolean;
  onToggleDetails?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onSave?: () => void;
  busy?: boolean;
  sourceLabels?: Record<string, string>;
  className?: string;
  style?: React.CSSProperties;
};

export function CandidateCardView({
  candidate,
  expanded = false,
  onToggleDetails,
  onApprove,
  onReject,
  onSave,
  busy = false,
  sourceLabels,
  className = "",
  style,
}: CandidateCardProps) {
  const location = formatLocation(candidate);
  const linkHost =
    hostnameFromUrl(candidate.officialUrl) ??
    hostnameFromUrl(candidate.applyUrl) ??
    null;
  const summary = getQueueSummary(candidate);

  return (
    <article
      className={[
        "hf-card hf-corner-marks flex w-full flex-col overflow-hidden",
        className,
      ].join(" ")}
      style={style}
      aria-label={candidate.name}
    >
      <span className="hf-corner-tr" aria-hidden="true" />
      <span className="hf-corner-bl" aria-hidden="true" />
      <CandidateHero candidate={candidate} sourceLabels={sourceLabels} />

      <div className="flex flex-1 flex-col gap-3 px-5 pb-3 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="hf-doc-title text-xl leading-snug tracking-tight sm:text-[1.35rem]">
              {candidate.name}
            </h2>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
              {location}
            </p>
          </div>
          <CandidateScore score={candidate.score} />
        </div>

        <p className="text-sm leading-relaxed text-foreground/85">{summary}</p>

        {candidate.status === "NEEDS_REVIEW" ? (
          <p className="rounded-[var(--radius-md)] border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
            Needs a human check before normal approval. Review links and red flags before deciding.
          </p>
        ) : null}

        <CandidateMetadata candidate={candidate} linkHost={linkHost} />

        {expanded ? (
          <div className="space-y-4 border-t border-border/70 pt-4">
            <CandidateTags themes={candidate.themes} />
            {candidate.whyMatch.length > 0 ? (
              <section>
                <h3 className="hf-section-label">Why it matches</h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/80">
                  {candidate.whyMatch.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {candidate.redFlags.length > 0 || !candidate.officialUrl ? (
              <section>
                <h3 className="hf-section-label text-amber-300/80">Red flags</h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-100/80">
                  {!candidate.officialUrl ? <li>Needs official link</li> : null}
                  {candidate.redFlags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <CandidateEvidenceLinks candidate={candidate} />
          </div>
        ) : null}

        {onApprove && onReject && onSave ? (
          <div className="mt-auto pt-2">
            <CandidateActions
              onApprove={onApprove}
              onReject={onReject}
              onSave={onSave}
              disabled={busy}
            />
          </div>
        ) : null}

        {onToggleDetails ? (
          <div className="mt-auto flex justify-center pt-1">
            <button
              type="button"
              onClick={onToggleDetails}
              className="hf-focus flex min-h-11 min-w-[4.5rem] flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-4 text-muted transition-colors hover:text-foreground"
              aria-label="Open details"
            >
              <span
                aria-hidden
                className="block h-1 w-10 rounded-full bg-current opacity-45"
              />
              <svg
                aria-hidden
                viewBox="0 0 20 12"
                className="h-3 w-4 opacity-70"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 3.5 10 9l7-5.5" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
