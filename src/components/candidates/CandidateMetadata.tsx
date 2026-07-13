import type { CandidateCard } from "@/core/candidates/types";
import {
  formatDate,
  formatDateRange,
  formatMode,
  formatTemporalStatus,
} from "@/lib/candidates/format";

export function CandidateMetadata({
  candidate,
  linkHost,
}: {
  candidate: CandidateCard;
  linkHost: string | null;
}) {
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex gap-2">
        <dt className="w-5 shrink-0 text-muted" aria-hidden>
          📅
        </dt>
        <dd>
          {formatDateRange(candidate.startDate, candidate.endDate)}
          <span className="ml-2 text-xs text-muted">
            {formatTemporalStatus(candidate)}
          </span>
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-5 shrink-0 text-muted" aria-hidden>
          ⏳
        </dt>
        <dd>
          {candidate.deadline
            ? `Deadline ${formatDate(candidate.deadline)}`
            : "Deadline unclear"}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-5 shrink-0 text-muted" aria-hidden>
          ◎
        </dt>
        <dd>{formatMode(candidate.mode)}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-5 shrink-0 text-muted" aria-hidden>
          🔗
        </dt>
        <dd className="truncate text-sky-300">
          {linkHost ?? (
            <span className="text-amber-300">Needs official link</span>
          )}
        </dd>
      </div>
    </dl>
  );
}
