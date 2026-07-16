import type {
  CandidateRecordSet,
  GenericShadowLead,
  InferredEventSchema,
  NormalizedStatus,
  SourceExperiment,
} from "@/crawl/adapters/custom/generic/types";
import {
  cleanText,
  isLikelyUrl,
  normalizeRatio,
  parseDateish,
  stableDedupeKey,
  valueAtPath,
} from "@/crawl/adapters/custom/generic/valueUtils";

function resolveUrl(raw: unknown, experiment: SourceExperiment): string | undefined {
  const text = cleanText(raw);
  if (!text) return undefined;
  if (!isLikelyUrl(text) && !/^[a-z0-9][a-z0-9-_/]{2,}$/i.test(text)) return undefined;
  try {
    const base = new URL(experiment.inputUrl);
    const normalized = text.startsWith("/")
      ? text
      : isLikelyUrl(text)
        ? text
        : `/${text.replace(/^\/+/, "")}`;
    const url = new URL(normalized, base).toString();
    const parsed = new URL(url);
    if (!experiment.allowedOrigins.includes(parsed.origin)) return undefined;
    if (parsed.pathname.replace(/\/$/, "") === base.pathname.replace(/\/$/, "")) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function inferStatus(input: {
  rawStatus?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  record: unknown;
}): { status: NormalizedStatus; source: string; confidence: number } {
  const raw = `${input.rawStatus ?? ""} ${JSON.stringify(input.record).slice(0, 1_000)}`.toLowerCase();
  if (/\b(archived|past|ended|complete|completed|closed|inactive)\b/.test(raw)) {
    return { status: /\b(closed|inactive)\b/.test(raw) ? "closed" : "past", source: "explicit structured status", confidence: 0.9 };
  }
  if (/\b(open|accepting|active|live|register|registration open)\b/.test(raw)) {
    return { status: "open", source: "explicit structured status", confidence: 0.85 };
  }
  if (/\b(upcoming|soon|scheduled)\b/.test(raw)) {
    return { status: "upcoming", source: "explicit structured status", confidence: 0.8 };
  }
  const now = Date.now();
  const start = input.startDate ? new Date(input.startDate).getTime() : undefined;
  const end = input.endDate ? new Date(input.endDate).getTime() : undefined;
  const deadline = input.deadline ? new Date(input.deadline).getTime() : undefined;
  if (end && end < now) return { status: "past", source: "end date", confidence: 0.8 };
  if (deadline && deadline < now && !start) return { status: "closed", source: "deadline", confidence: 0.65 };
  if (start && start > now) return { status: "upcoming", source: "start date", confidence: 0.75 };
  if (start && end && start <= now && end >= now) return { status: "ongoing", source: "date range", confidence: 0.8 };
  return { status: "unknown", source: "insufficient structured status", confidence: 0.35 };
}

function isValidEventStatus(status: NormalizedStatus): boolean {
  return status === "open" || status === "upcoming" || status === "ongoing" || status === "unknown";
}

function confidenceFor(schema: InferredEventSchema, lead: GenericShadowLead): number {
  const urlBoost = lead.canonicalUrl ? 0.1 : 0;
  const dateBoost = lead.startDate || lead.deadline ? 0.08 : 0;
  const statusBoost = lead.normalizedStatus === "unknown" ? 0 : 0.05;
  return normalizeRatio(schema.confidence + urlBoost + dateBoost + statusBoost);
}

export function normalizeGenericRecords(
  recordSet: CandidateRecordSet,
  schema: InferredEventSchema,
  experiment: SourceExperiment,
): GenericShadowLead[] {
  if (schema.rejected) return [];
  const leads: GenericShadowLead[] = [];
  const seen = new Set<string>();

  for (const record of recordSet.records) {
    const title = cleanText(valueAtPath(record, schema.title.path));
    if (
      !title ||
      title.length < 3 ||
      /^(open|past|upcoming|organize|menu|home)$/i.test(title) ||
      /^(registration\s+(start|end|opens?|closes?)|starts?|ends?|deadline)\s*:/i.test(title)
    ) {
      continue;
    }
    const url = schema.url ? resolveUrl(valueAtPath(record, schema.url.path), experiment) : undefined;
    const sourceRecordId = cleanText(valueAtPath(record, schema.sourceRecordId?.path));
    const startDate = parseDateish(valueAtPath(record, schema.startDate?.path));
    const endDate = parseDateish(valueAtPath(record, schema.endDate?.path));
    const deadline = parseDateish(valueAtPath(record, schema.deadline?.path));
    const rawStatus = cleanText(valueAtPath(record, schema.status?.path));
    const status = inferStatus({ rawStatus, startDate, endDate, deadline, record });
    if (!isValidEventStatus(status.status)) continue;

    const lead: GenericShadowLead = {
      sourceUrl: experiment.inputUrl,
      artifactKind: recordSet.artifactKind,
      title,
      ...(url ? { canonicalUrl: url } : {}),
      ...(sourceRecordId ? { sourceRecordId } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(deadline ? { deadline } : {}),
      ...(cleanText(valueAtPath(record, schema.location?.path))
        ? { location: cleanText(valueAtPath(record, schema.location?.path)) }
        : {}),
      ...(cleanText(valueAtPath(record, schema.mode?.path))
        ? { mode: cleanText(valueAtPath(record, schema.mode?.path)) }
        : {}),
      ...(cleanText(valueAtPath(record, schema.description?.path))
        ? { description: cleanText(valueAtPath(record, schema.description?.path)) }
        : {}),
      ...(rawStatus ? { rawStatus } : {}),
      normalizedStatus: status.status,
      statusInference: status.source,
      confidence: status.confidence,
    };
    lead.confidence = confidenceFor(schema, lead);
    const key = stableDedupeKey([lead.sourceRecordId, lead.canonicalUrl, lead.title, lead.startDate]);
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push(lead);
  }

  return leads;
}
