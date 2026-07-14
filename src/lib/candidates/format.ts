import type { CandidateCard } from "@/core/candidates/types";
import type { CandidateMode } from "@/lib/supabase/database.types";
import { deriveEventTemporalStatus } from "@/core/dates";

export function formatDateRange(
  start: string | null,
  end: string | null,
): string {
  if (!start && !end) return "Date unclear";
  if (start && end && start !== end) return `${formatDate(start)} – ${formatDate(end)}`;
  return formatDate(start ?? end!);
}

export function formatDate(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatTemporalStatus(candidate: CandidateCard): string {
  const status = deriveEventTemporalStatus({
    startDate: candidate.startDate,
    endDate: candidate.endDate,
    timezone: "UTC",
  });
  switch (status) {
    case "UPCOMING":
      return "Upcoming";
    case "ONGOING":
      return "Ongoing";
    case "FINISHED":
      return "Finished";
    case "UNKNOWN":
      return "Date unclear";
  }
}

export function formatLocation(candidate: CandidateCard): string {
  if (candidate.location) return candidate.location;
  const parts = [candidate.city, candidate.country].filter(Boolean);
  if (parts.length) return parts.join(", ");
  if (candidate.mode === "online") return "Online";
  return "Location unclear";
}

export function formatMode(mode: CandidateMode | null): string {
  switch (mode) {
    case "online":
      return "Online";
    case "in-person":
      return "In person";
    case "hybrid":
      return "Hybrid";
    case "unknown":
      return "Mode unclear";
    default:
      return "Mode unclear";
  }
}

export function hostnameFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Display label for a candidate source slug (never mutate storage values). */
export function formatSourceLabel(source: string): string {
  const normalized = source.toLowerCase();
  if (/^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    return source.slice("custom:".length)
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }
  switch (normalized) {
    case "mock":
      return "Mock";
    case "hacklist":
      return "HackList";
    case "hakku":
      return "Hakku";
    case "devpost":
      return "Devpost";
    case "mlh":
      return "MLH";
    case "luma":
      return "Luma";
    case "web":
      return "Web";
    case "x":
    case "twitter":
      return "X";
    default: {
      const trimmed = source.trim();
      if (!trimmed) return source;
      return trimmed
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
    }
  }
}

export function scoreTone(score: number): string {
  if (score >= 75) return "text-emerald-300";
  if (score >= 50) return "text-amber-300";
  return "text-slate-300";
}
