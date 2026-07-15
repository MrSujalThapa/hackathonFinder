import type {
  CandidateArrayDiagnostic,
  ShadowLead,
  StructuredArtifactKind,
  UrlResolution,
} from "@/experiments/scraper-v2/types";
import { valueAtPath } from "@/experiments/scraper-v2/inferFieldMappings";
import { DEVFOLIO_CONFIG } from "@/experiments/scraper-v2/devfolioConfig";

function asText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).replace(/\s+/g, " ").trim();
    return text || undefined;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return asText(record.name ?? record.title ?? record.label ?? record.city ?? record.country);
  }
  return undefined;
}

function normalizeDate(value: unknown): string | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  return text.slice(0, 80);
}

function layer(kind: StructuredArtifactKind): ShadowLead["extractionLayer"] {
  if (kind === "json_ld") return "embedded_json";
  return kind;
}

export function resolveDevfolioUrl(record: Record<string, unknown>, diagnostic: CandidateArrayDiagnostic): UrlResolution {
  const rawUrl = asText(valueAtPath(record, diagnostic.probableFields.url));
  const slug = asText(valueAtPath(record, diagnostic.probableFields.slug));

  if (rawUrl) {
    try {
      const resolved = new URL(rawUrl, DEVFOLIO_CONFIG.listingUrl);
      if (DEVFOLIO_CONFIG.rejectedPaths.has(resolved.pathname.replace(/\/$/, ""))) {
        return { raw: rawUrl, strategy: "rejected_listing", confidence: 0 };
      }
      if (resolved.hostname === DEVFOLIO_CONFIG.allowedHostname) {
        return {
          raw: rawUrl,
          resolved: resolved.toString(),
          strategy: rawUrl.startsWith("http") ? "absolute" : "relative",
          confidence: 0.95,
        };
      }
    } catch {
      return { raw: rawUrl, strategy: "none", confidence: 0 };
    }
  }

  if (slug && /^[a-z0-9][a-z0-9-]+$/i.test(slug)) {
    const resolved = new URL(`/${slug}`, DEVFOLIO_CONFIG.listingUrl).toString();
    return { raw: slug, resolved, strategy: "slug", confidence: 0.75 };
  }

  return { strategy: "none", confidence: 0 };
}

function isPastRecord(status: string | undefined, record: Record<string, unknown>): boolean {
  const blob = JSON.stringify({
    status,
    state: record.state,
    phase: record.phase,
    isPast: record.isPast,
    hasEnded: record.hasEnded,
  });
  return DEVFOLIO_CONFIG.pastStatusPattern.test(blob) || /\btrue\b/i.test(String(record.isPast));
}

function isOpenOrUpcoming(status: string | undefined, record: Record<string, unknown>): boolean {
  const blob = JSON.stringify({ status, state: record.state, phase: record.phase, tab: record.tab });
  if (!status && !blob) return true;
  if (DEVFOLIO_CONFIG.openStatusPattern.test(blob)) return true;
  if (!DEVFOLIO_CONFIG.pastStatusPattern.test(blob)) return true;
  return false;
}

function dedupeKey(lead: ShadowLead): string {
  return (
    lead.sourceRecordId ||
    lead.canonicalUrl ||
    `${lead.title.toLowerCase()}|${lead.startDate ?? ""}`
  );
}

export function normalizeStructuredRecords(
  records: unknown[],
  diagnostic: CandidateArrayDiagnostic,
): ShadowLead[] {
  const leads: ShadowLead[] = [];
  const seen = new Set<string>();

  for (const item of records) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const title = asText(valueAtPath(record, diagnostic.probableFields.title));
    if (!title || DEVFOLIO_CONFIG.nonEventTitlePattern.test(title)) continue;

    const rawStatus = asText(valueAtPath(record, diagnostic.probableFields.status));
    if (isPastRecord(rawStatus, record) || !isOpenOrUpcoming(rawStatus, record)) continue;

    const url = resolveDevfolioUrl(record, diagnostic);
    if (url.strategy === "rejected_listing") continue;
    const id = asText(valueAtPath(record, diagnostic.probableFields.id));
    const startDate = normalizeDate(valueAtPath(record, diagnostic.probableFields.startDate));
    const endDate = normalizeDate(valueAtPath(record, diagnostic.probableFields.endDate));
    const deadline = normalizeDate(valueAtPath(record, diagnostic.probableFields.registrationDeadline));
    const lead: ShadowLead = {
      sourceId: DEVFOLIO_CONFIG.sourceId,
      extractionLayer: layer(diagnostic.artifactKind),
      title,
      ...(url.resolved ? { canonicalUrl: url.resolved } : {}),
      ...(id ? { sourceRecordId: id } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(deadline ? { registrationDeadline: deadline } : {}),
      ...(asText(valueAtPath(record, diagnostic.probableFields.location))
        ? { location: asText(valueAtPath(record, diagnostic.probableFields.location)) }
        : {}),
      ...(asText(valueAtPath(record, diagnostic.probableFields.mode))
        ? { mode: asText(valueAtPath(record, diagnostic.probableFields.mode)) }
        : {}),
      ...(asText(valueAtPath(record, diagnostic.probableFields.description))
        ? { description: asText(valueAtPath(record, diagnostic.probableFields.description)) }
        : {}),
      ...(rawStatus ? { rawStatus } : {}),
      confidence: Math.min(1, Number((diagnostic.confidence * (url.confidence || 0.7)).toFixed(2))),
    };
    const key = dedupeKey(lead);
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push(lead);
  }

  return leads;
}
