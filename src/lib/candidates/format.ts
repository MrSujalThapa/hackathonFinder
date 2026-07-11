import type { CandidateCard } from "@/core/candidates/types";
import type { CandidateMode } from "@/lib/supabase/database.types";

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

export function scoreTone(score: number): string {
  if (score >= 75) return "text-emerald-300";
  if (score >= 50) return "text-amber-300";
  return "text-slate-300";
}
