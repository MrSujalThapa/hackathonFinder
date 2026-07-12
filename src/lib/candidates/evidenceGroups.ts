import { normalizeEvidenceUrlKey } from "@/lib/http/evidenceUrl";
import type { CandidateEvidence } from "@/core/candidates/types";
import type { EvidenceType } from "@/lib/supabase/database.types";

export type EvidenceGroup = {
  key: string;
  type: EvidenceType;
  url: string | null;
  title: string;
  domain: string | null;
  authority: number;
  lastVerified: string;
  seenCount: number;
  items: CandidateEvidence[];
};

const TYPE_AUTHORITY: Record<string, number> = {
  official_page: 100,
  apply_page: 90,
  mlh_page: 80,
  devpost_page: 78,
  luma_page: 70,
  hacklist_card: 55,
  hakku_card: 55,
  source_card: 40,
  search_result: 35,
  x_post: 20,
  manual_lead: 25,
};

export function evidenceTypeLabel(type: EvidenceType | string): string {
  switch (type) {
    case "official_page":
      return "Official";
    case "apply_page":
      return "Application";
    case "x_post":
      return "Social";
    case "search_result":
      return "Search";
    case "manual_lead":
      return "Manual";
    case "luma_page":
      return "Luma";
    case "devpost_page":
      return "Devpost";
    case "mlh_page":
      return "MLH";
    case "hacklist_card":
      return "HackList";
    case "hakku_card":
      return "Hakku";
    case "source_card":
      return "Source";
    default:
      return type.replace(/_/g, " ");
  }
}

function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function groupCandidateEvidence(
  evidence: CandidateEvidence[],
): EvidenceGroup[] {
  const map = new Map<string, EvidenceGroup>();

  for (const item of evidence) {
    const urlKey = normalizeEvidenceUrlKey(item.url);
    const key = `${item.type}|${urlKey}`;
    const existing = map.get(key);
    const last =
      item.lastSeenAt ?? item.foundAt ?? new Date(0).toISOString();
    const seen = item.seenCount ?? 1;

    if (!existing) {
      map.set(key, {
        key,
        type: item.type,
        url: item.url,
        title: item.title ?? item.snippet ?? evidenceTypeLabel(item.type),
        domain: domainFromUrl(item.url),
        authority: TYPE_AUTHORITY[item.type] ?? 30,
        lastVerified: last,
        seenCount: seen,
        items: [item],
      });
      continue;
    }

    existing.seenCount += seen;
    existing.items.push(item);
    if (last > existing.lastVerified) existing.lastVerified = last;
    if (!existing.title && (item.title || item.snippet)) {
      existing.title = item.title ?? item.snippet ?? existing.title;
    }
  }

  return [...map.values()].sort((a, b) => {
    if (b.authority !== a.authority) return b.authority - a.authority;
    return b.lastVerified.localeCompare(a.lastVerified);
  });
}

/** Prefer unique high-authority sources; hide duplicate apply when official shares host path family. */
export function selectPrimaryEvidenceGroups(
  groups: EvidenceGroup[],
  limit = 5,
): { primary: EvidenceGroup[]; rest: EvidenceGroup[] } {
  const primary: EvidenceGroup[] = [];
  const rest: EvidenceGroup[] = [];

  for (const group of groups) {
    if (primary.length >= limit) {
      rest.push(group);
      continue;
    }
    // Avoid near-identical official+apply clutter when titles match and same domain
    const dupApply =
      group.type === "apply_page" &&
      primary.some(
        (p) =>
          p.type === "official_page" &&
          p.domain &&
          p.domain === group.domain &&
          normalizeEvidenceUrlKey(p.url) === normalizeEvidenceUrlKey(group.url),
      );
    if (dupApply) {
      rest.push(group);
      continue;
    }
    primary.push(group);
  }

  return { primary, rest };
}
