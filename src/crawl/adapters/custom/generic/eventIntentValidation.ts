import type {
  CandidateRecordSet,
  EventIntentValidation,
  GenericShadowLead,
  InferredEventSchema,
} from "@/crawl/adapters/custom/generic/types";
import {
  boundedJson,
  cleanText,
  flattenRecordKeys,
  isPlainRecord,
  normalizeRatio,
  parseDateish,
  stableDedupeKey,
  valueAtPath,
} from "@/crawl/adapters/custom/generic/valueUtils";

const GENERIC_TITLES = /^(open|closed|past|upcoming|organize|organized by|menu|home|about|sponsor|sponsors|faq|resources?|category|filter|all|status|view|learn more|register|apply)$/i;
const NEGATIVE_PATH = /\/(?:about|login|signin|signup|sponsors?|organizers?|contact|privacy|terms|faq|blog|resources?)\/?$/i;
const EVENT_WORDS = /\b(hackathon|challenge|competition|event|summit|conference|demo day|build|jam|bounty|sprint|meetup|workshop)\b/i;
const EVENT_FIELDS = /\b(date|start|end|deadline|location|venue|city|country|online|virtual|hybrid|registration|prize|track|team|eligibility|organizer|schedule)\b/i;

function titleFrom(record: Record<string, unknown>, schema?: InferredEventSchema): string | undefined {
  if (schema) return cleanText(valueAtPath(record, schema.title.path));
  for (const key of ["title", "name", "display", "headline", "label"]) {
    const value = cleanText(record[key]);
    if (value) return value;
  }
  return undefined;
}

function urlFrom(record: Record<string, unknown>, schema?: InferredEventSchema): string | undefined {
  if (schema?.url) return cleanText(valueAtPath(record, schema.url.path));
  for (const key of ["url", "href", "link", "route", "path", "slug", "permalink", "canonical"]) {
    const value = cleanText(record[key]);
    if (value) return value;
  }
  return undefined;
}

function idFrom(record: Record<string, unknown>, schema?: InferredEventSchema): string | undefined {
  if (schema?.sourceRecordId) return cleanText(valueAtPath(record, schema.sourceRecordId.path));
  for (const key of ["id", "uid", "uuid", "slug", "key", "identifier"]) {
    const value = cleanText(record[key]);
    if (value) return value;
  }
  return undefined;
}

function hasDateSignal(record: Record<string, unknown>, schema?: InferredEventSchema): boolean {
  if (schema) {
    return Boolean(
      parseDateish(valueAtPath(record, schema.startDate?.path)) ||
        parseDateish(valueAtPath(record, schema.endDate?.path)) ||
        parseDateish(valueAtPath(record, schema.deadline?.path)),
    );
  }
  return flattenRecordKeys(record).some((path) => EVENT_FIELDS.test(path) && parseDateish(valueAtPath(record, path)));
}

function uniqueRatio(values: Array<string | undefined>): number {
  const present = values.filter((value): value is string => Boolean(value));
  return normalizeRatio(present.length === 0 ? 0 : new Set(present.map((value) => value.toLowerCase())).size / present.length);
}

function reusedListingUrlRatio(urls: Array<string | undefined>): number {
  const present = urls.filter((value): value is string => Boolean(value));
  if (present.length === 0) return 0;
  const normalized = present.map((value) => value.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase());
  const repeated = normalized.filter((value) => normalized.filter((other) => other === value).length > 1).length;
  return normalizeRatio(repeated / present.length);
}

function leadPrecisionSignals(leads: GenericShadowLead[] | undefined): {
  precisionBoost: number;
  reasons: string[];
} {
  if (!leads || leads.length === 0) return { precisionBoost: 0, reasons: [] };
  const generic = leads.filter((lead) => GENERIC_TITLES.test(lead.title)).length;
  const negativeUrls = leads.filter((lead) => {
    if (!lead.canonicalUrl) return false;
    try {
      return NEGATIVE_PATH.test(new URL(lead.canonicalUrl).pathname);
    } catch {
      return true;
    }
  }).length;
  const precise = 1 - (generic + negativeUrls) / Math.max(1, leads.length);
  return {
    precisionBoost: normalizeRatio((precise - 0.7) * 0.25),
    reasons: precise < 0.9 ? ["normalized leads include likely non-event destinations"] : [],
  };
}

export function validateEventIntent(input: {
  recordSet: CandidateRecordSet;
  schema?: InferredEventSchema;
  leads?: GenericShadowLead[];
}): EventIntentValidation {
  const records = input.recordSet.records.filter(isPlainRecord).slice(0, 40);
  const titles = records.map((record) => titleFrom(record, input.schema));
  const urls = records.map((record) => urlFrom(record, input.schema));
  const blobs = records.map((record) => boundedJson(record, 1_500));
  const allKeys = [...new Set(records.flatMap((record) => flattenRecordKeys(record)))];
  const uniqueTitleRatio = uniqueRatio(titles);
  const uniqueUrlRatio = uniqueRatio(urls);
  const stableIdentityRatio = uniqueRatio(records.map((record) => stableDedupeKey([idFrom(record, input.schema), urlFrom(record, input.schema), titleFrom(record, input.schema)])));
  const dateSignalRatio = normalizeRatio(records.filter((record) => hasDateSignal(record, input.schema)).length / Math.max(1, records.length));
  const genericTitleRatio = normalizeRatio(titles.filter((title) => title && GENERIC_TITLES.test(title)).length / Math.max(1, titles.filter(Boolean).length));
  const listingUrlReuseRatio = reusedListingUrlRatio(urls);
  const hasEventVocabulary = EVENT_WORDS.test(`${allKeys.join(" ")} ${blobs.join(" ")}`);
  const hasFieldSignals = EVENT_FIELDS.test(`${allKeys.join(" ")} ${blobs.join(" ")}`);
  const schemaRejected = input.schema?.rejected === true;
  const leadSignals = leadPrecisionSignals(input.leads);

  const identityScore = normalizeRatio(uniqueTitleRatio * 0.35 + uniqueUrlRatio * 0.3 + stableIdentityRatio * 0.35 - listingUrlReuseRatio * 0.35);
  const schemaTrustScore = normalizeRatio(
    input.recordSet.confidence * 0.35 +
      input.recordSet.eventScore * 0.25 +
      (input.schema?.confidence ?? 0) * 0.25 +
      dateSignalRatio * 0.15 -
      (schemaRejected ? 0.45 : 0),
  );
  const negativePenalty = genericTitleRatio * 0.45 + listingUrlReuseRatio * 0.25 + (schemaRejected ? 0.2 : 0);
  const eventIntentScore = normalizeRatio(
    schemaTrustScore * 0.35 +
      identityScore * 0.3 +
      dateSignalRatio * 0.15 +
      (hasEventVocabulary ? 0.12 : 0) +
      (hasFieldSignals ? 0.08 : 0) +
      leadSignals.precisionBoost -
      negativePenalty,
  );

  const reasons: string[] = [];
  if (hasEventVocabulary) reasons.push("event-like vocabulary present");
  if (hasFieldSignals) reasons.push("event field signals present");
  if (uniqueTitleRatio < 0.6) reasons.push("titles are not sufficiently unique");
  if (uniqueUrlRatio < 0.4 && stableIdentityRatio < 0.5) reasons.push("records lack stable identity");
  if (genericTitleRatio > 0.2) reasons.push("generic navigation/status titles present");
  if (listingUrlReuseRatio > 0.25) reasons.push("listing/category URLs are reused across records");
  if (schemaRejected) reasons.push("schema was rejected");
  reasons.push(...leadSignals.reasons);

  let classification: EventIntentValidation["classification"] = "rejected";
  if (eventIntentScore >= 0.75 && identityScore >= 0.7 && schemaTrustScore >= 0.55) classification = "healthy";
  else if (eventIntentScore >= 0.58 && identityScore >= 0.5 && schemaTrustScore >= 0.45) classification = "usable";
  else if (eventIntentScore >= 0.42 && identityScore >= 0.35) classification = "ambiguous";

  return {
    recordSetId: input.recordSet.recordSetId,
    eventIntentScore,
    identityScore,
    schemaTrustScore,
    classification,
    reasons,
    metrics: {
      inspectedRecords: records.length,
      uniqueTitleRatio,
      uniqueUrlRatio,
      stableIdentityRatio,
      dateSignalRatio,
      genericTitleRatio,
      listingUrlReuseRatio,
    },
  };
}
