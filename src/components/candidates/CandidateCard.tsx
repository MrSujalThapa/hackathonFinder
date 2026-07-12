"use client";

import type { CandidateCard } from "@/core/candidates/types";
import { CandidateActions } from "@/components/candidates/CandidateActions";
import { CandidateEvidenceLinks } from "@/components/candidates/CandidateEvidenceLinks";
import { CandidateHero } from "@/components/candidates/CandidateHero";
import { CandidateMetadata } from "@/components/candidates/CandidateMetadata";
import { CandidateScore } from "@/components/candidates/CandidateScore";
import { CandidateTags } from "@/components/candidates/CandidateTags";
import { formatLocation, hostnameFromUrl } from "@/lib/candidates/format";

type CandidateCardProps = {
  candidate: CandidateCard;
  expanded?: boolean;
  onToggleDetails?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onSave?: () => void;
  busy?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

function summarize(text: string | null | undefined): string {
  const raw = (text ?? "").trim();
  if (!raw) return "No summary available yet.";
  const cleaned = raw
    .replace(/\|+/g, " · ")
    .replace(/-{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 220) return cleaned;
  return `${cleaned.slice(0, 217).trim()}…`;
}

export function CandidateCardView({
  candidate,
  expanded = false,
  onToggleDetails,
  onApprove,
  onReject,
  onSave,
  busy = false,
  className = "",
  style,
}: CandidateCardProps) {
  const location = formatLocation(candidate);
  const linkHost =
    hostnameFromUrl(candidate.officialUrl) ??
    hostnameFromUrl(candidate.applyUrl) ??
    null;

  return (
    <article
      className={[
        "flex w-full max-w-[var(--content-queue)] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-card)]",
        className,
      ].join(" ")}
      style={style}
      aria-label={candidate.name}
    >
      <CandidateHero candidate={candidate} />

      <div className="flex flex-1 flex-col gap-3 px-5 pb-5 pt-3">
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

        <p className="text-sm leading-relaxed text-foreground/85">
          {summarize(candidate.summary)}
        </p>

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

        <div className="mt-auto space-y-3 pt-2">
          {onToggleDetails ? (
            <button
              type="button"
              onClick={onToggleDetails}
              className="hf-btn hf-btn-ghost hf-touch w-full"
            >
              {expanded ? "Hide details" : "More details"}
            </button>
          ) : null}

          {onApprove && onReject && onSave ? (
            <CandidateActions
              onApprove={onApprove}
              onReject={onReject}
              onSave={onSave}
              disabled={busy}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
