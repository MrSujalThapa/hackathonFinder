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

function statusClass(status: CandidateCard["status"]): string {
  if (status === "NEEDS_REVIEW") {
    return "border-amber-400/50 bg-amber-400/10 text-amber-100";
  }
  if (status === "NEW") return "border-sky-400/40 bg-sky-400/10 text-sky-100";
  if (status === "APPROVED") {
    return "border-emerald-400/50 bg-emerald-400/10 text-emerald-100";
  }
  return "border-border bg-white/5 text-muted";
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
        "flex w-full max-w-[420px] flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-[0_24px_60px_rgba(0,0,0,0.45)]",
        className,
      ].join(" ")}
      style={style}
      aria-label={candidate.name}
    >
      <CandidateHero candidate={candidate} />

      <div className="flex flex-1 flex-col gap-4 px-5 pb-5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-2">
              <span
                className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${statusClass(candidate.status)}`}
              >
                {candidate.status === "NEEDS_REVIEW" ? "Needs review" : candidate.status}
              </span>
              <span className="rounded-full border border-border bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {candidate.source}
              </span>
            </div>
            <h2 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
              {candidate.name}
            </h2>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              {location}
            </p>
          </div>
          <CandidateScore score={candidate.score} />
        </div>

        <p className="text-sm leading-relaxed text-foreground/80">
          {candidate.summary?.trim() || "No summary available yet."}
        </p>

        {candidate.status === "NEEDS_REVIEW" ? (
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
            Needs a human check before normal approval. Review links and red flags before deciding.
          </p>
        ) : null}

        <CandidateMetadata candidate={candidate} linkHost={linkHost} />
        <CandidateTags themes={candidate.themes} />

        {expanded ? (
          <div className="space-y-4 border-t border-border/70 pt-4">
            {candidate.whyMatch.length > 0 ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Why it matches
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/80">
                  {candidate.whyMatch.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {candidate.redFlags.length > 0 || !candidate.officialUrl ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300/80">
                  Red flags
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-100/80">
                  {!candidate.officialUrl ? <li>Needs official link</li> : null}
                  {candidate.redFlags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {candidate.prize ? (
              <p className="text-sm text-foreground/80">
                <span className="text-muted">Prize: </span>
                {candidate.prize}
              </p>
            ) : null}

            {candidate.eligibility ? (
              <p className="text-sm text-foreground/80">
                <span className="text-muted">Eligibility: </span>
                {candidate.eligibility}
              </p>
            ) : null}

            <CandidateEvidenceLinks candidate={candidate} />

            <p className="text-[11px] text-muted">
              Verified {new Date(candidate.lastVerified).toLocaleString()}
            </p>
          </div>
        ) : null}

        <div className="mt-auto space-y-3 pt-2">
          {onToggleDetails ? (
            <button
              type="button"
              onClick={onToggleDetails}
              className="w-full rounded-xl border border-border/80 px-3 py-2 text-sm text-muted transition-colors hover:border-sky-500/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
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
