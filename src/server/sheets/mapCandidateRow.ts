import type { CandidateCard } from "@/core/candidates/types";
import { SHEET_HEADERS } from "@/server/sheets/schema";

export type MapCandidateRowInput = CandidateCard & {
  approvedAt?: string | null;
};

function cell(value: string | number | null | undefined): string {
  if (value == null) {
    return "";
  }
  return String(value);
}

function joinList(values: string[] | null | undefined): string {
  if (!values || values.length === 0) {
    return "";
  }
  return values.join("; ");
}

/**
 * Prefer YYYY-MM-DD when the value is a parseable date/datetime.
 * Otherwise return the original string (or "" when missing).
 */
export function formatSheetDate(value: string | null | undefined): string {
  if (value == null || value === "") {
    return "";
  }

  const leadingIso = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (leadingIso) {
    return leadingIso[1];
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return value;
}

export function mapCandidateRow(
  candidate: MapCandidateRowInput,
  approvedAt?: string | null,
): string[] {
  const resolvedApprovedAt =
    approvedAt !== undefined ? approvedAt : candidate.approvedAt;

  const row: string[] = [
    cell(candidate.status),
    cell(candidate.score),
    cell(candidate.name),
    cell(candidate.source),
    cell(candidate.officialUrl),
    cell(candidate.applyUrl),
    cell(candidate.socialUrl),
    formatSheetDate(candidate.startDate),
    formatSheetDate(candidate.endDate),
    formatSheetDate(candidate.deadline),
    cell(candidate.location),
    cell(candidate.mode),
    cell(candidate.city),
    cell(candidate.country),
    cell(candidate.prize),
    joinList(candidate.themes),
    cell(candidate.eligibility),
    cell(candidate.summary),
    joinList(candidate.whyMatch),
    joinList(candidate.redFlags),
    formatSheetDate(candidate.foundAt),
    formatSheetDate(candidate.lastVerified),
    formatSheetDate(resolvedApprovedAt),
    cell(candidate.id),
  ];

  if (row.length !== SHEET_HEADERS.length) {
    throw new Error(
      `mapCandidateRow produced ${row.length} cells; expected ${SHEET_HEADERS.length}`,
    );
  }

  return row;
}
