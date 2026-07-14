import type {
  CandidateRecordSet,
  FieldMapping,
  InferredEventSchema,
} from "@/experiments/scraper-v2/generic/types";
import {
  cleanText,
  flattenRecordKeys,
  isLikelyUrl,
  isPlainRecord,
  normalizeRatio,
  parseDateish,
  valueAtPath,
} from "@/experiments/scraper-v2/generic/valueUtils";

type FieldName = Exclude<keyof InferredEventSchema, "recordSetId" | "confidence" | "rejected" | "rejectionReasons">;

type CandidateField = FieldMapping & {
  field: FieldName;
  coverage: number;
};

const FIELD_KEY_HINTS: Record<FieldName, RegExp[]> = {
  title: [/\b(title|name|headline|label)\b/i],
  url: [/\b(url|href|link|website|site|permalink|canonical|route|path|slug)\b/i],
  startDate: [/\b(start|starts|begin|begins|from|launch|opens?|date)\b/i],
  endDate: [/\b(end|ends|finish|finishes|to|closes?|closed|complete)\b/i],
  deadline: [/\b(deadline|due|apply|registration|submission|closes|ends)\b/i],
  location: [/\b(location|venue|city|country|region|address|place)\b/i],
  mode: [/\b(mode|format|type|online|virtual|hybrid|remote)\b/i],
  description: [/\b(description|summary|subtitle|tagline|about|excerpt|details)\b/i],
  status: [/\b(status|state|phase|open|closed|active|upcoming|past|registration)\b/i],
  sourceRecordId: [/\b(id|uuid|uid|identifier|key|slug|handle|position|rank|index)\b/i],
};

function keyMatches(path: string, patterns: RegExp[]): boolean {
  const normalized = path.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[^a-z0-9]+/gi, " ");
  return patterns.some((pattern) => pattern.test(path) || pattern.test(normalized));
}

function scoreTextTitle(values: unknown[], path: string): FieldMapping {
  const texts = values.map(cleanText).filter((value): value is string => Boolean(value));
  const coverage = texts.length / Math.max(1, values.length);
  const unique = new Set(texts.map((value) => value.toLowerCase())).size / Math.max(1, texts.length);
  const goodLength = texts.filter((value) => value.length >= 4 && value.length <= 140).length / Math.max(1, texts.length);
  const badUrl = texts.filter(isLikelyUrl).length / Math.max(1, texts.length);
  const statusish = texts.filter((value) => /^(open|closed|past|upcoming|active|online|virtual)$/i.test(value)).length / Math.max(1, texts.length);
  const schemaTypeish = texts.filter((value) => /^(ListItem|ItemList|Thing|WebPage|Event)$/i.test(value)).length / Math.max(1, texts.length);
  const keyHint = keyMatches(path, FIELD_KEY_HINTS.title) ? 0.25 : 0;
  const identityKeyPenalty =
    keyHint === 0 && keyMatches(path, FIELD_KEY_HINTS.sourceRecordId) ? 0.35 : 0;
  const urlKeyPenalty = keyHint === 0 && keyMatches(path, FIELD_KEY_HINTS.url) ? 0.35 : 0;
  const vocab = texts.some((value) => /hack|challenge|event|build|summit|competition|bounty/i.test(value)) ? 0.15 : 0;
  const rawConfidence =
    coverage * 0.2 +
    unique * 0.35 +
    goodLength * 0.2 +
    keyHint +
    vocab -
    badUrl * 0.4 -
    statusish * 0.35 -
    schemaTypeish * 0.45 -
    identityKeyPenalty -
    urlKeyPenalty;
  const confidence = normalizeRatio(unique < 0.3 ? Math.min(rawConfidence, 0.45) : rawConfidence);
  return { path, confidence, evidence: [`coverage=${coverage.toFixed(2)}`, `unique=${unique.toFixed(2)}`] };
}

function scoreUrl(values: unknown[], path: string): FieldMapping {
  const texts = values.map(cleanText).filter((value): value is string => Boolean(value));
  const hasRouteKeyHint = /\b(route|path|slug|url|href|link|permalink|canonical)\b/i.test(path);
  const urlish = texts.filter((value) =>
    isLikelyUrl(value) || (hasRouteKeyHint && /^[a-z0-9][a-z0-9-_/]{2,}$/i.test(value)),
  );
  const coverage = texts.length / Math.max(1, values.length);
  const keyHint = keyMatches(path, FIELD_KEY_HINTS.url) ? 0.45 : 0;
  const confidence = normalizeRatio((urlish.length / Math.max(1, texts.length)) * 0.45 + coverage * 0.2 + keyHint);
  return { path, confidence, evidence: [`urlish=${urlish.length}/${texts.length}`, `coverage=${coverage.toFixed(2)}`] };
}

function scoreDate(values: unknown[], path: string, field: FieldName): FieldMapping {
  const parsed = values.filter((value) => parseDateish(value)).length;
  const coverage = parsed / Math.max(1, values.length);
  const keyHint = keyMatches(path, FIELD_KEY_HINTS[field]) ? 0.4 : 0;
  const confidence = normalizeRatio(coverage * 0.55 + keyHint);
  return { path, confidence, evidence: [`parseable=${parsed}/${values.length}`] };
}

function scoreText(values: unknown[], path: string, field: FieldName): FieldMapping {
  const texts = values.map(cleanText).filter((value): value is string => Boolean(value));
  const coverage = texts.length / Math.max(1, values.length);
  const keyHint = keyMatches(path, FIELD_KEY_HINTS[field]) ? 0.45 : 0;
  let semantic = 0;
  const blob = texts.join(" ");
  if (field === "location" && /\b(online|virtual|hybrid|remote|[A-Z][a-z]+,\s*[A-Z][a-z]+)\b/.test(blob)) semantic = 0.2;
  if (field === "mode" && /\b(online|virtual|hybrid|remote|in.?person)\b/i.test(blob)) semantic = 0.3;
  if (field === "status" && /\b(open|closed|active|upcoming|ongoing|past|complete|archived)\b/i.test(blob)) semantic = 0.3;
  if (field === "description" && texts.some((value) => value.length > 40)) semantic = 0.25;
  if (field === "sourceRecordId" && new Set(texts).size >= Math.min(5, texts.length)) semantic = 0.25;
  const confidence = normalizeRatio(coverage * 0.3 + keyHint + semantic);
  return { path, confidence, evidence: [`coverage=${coverage.toFixed(2)}`] };
}

function allPaths(records: Array<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const record of records.slice(0, 30)) {
    for (const key of flattenRecordKeys(record, "", 0, 3)) keys.add(key);
  }
  return [...keys];
}

function valuesFor(records: Array<Record<string, unknown>>, path: string): unknown[] {
  return records.map((record) => valueAtPath(record, path));
}

function bestField(records: Array<Record<string, unknown>>, field: FieldName): CandidateField | undefined {
  const candidates = allPaths(records).map((path) => {
    const values = valuesFor(records, path);
    let mapping: FieldMapping;
    if (field === "title") mapping = scoreTextTitle(values, path);
    else if (field === "url") mapping = scoreUrl(values, path);
    else if (field === "startDate" || field === "endDate" || field === "deadline") {
      mapping = scoreDate(values, path, field);
    } else {
      mapping = scoreText(values, path, field);
    }
    const coverage = values.filter((value) => cleanText(value) || parseDateish(value)).length / Math.max(1, values.length);
    return { ...mapping, field, coverage };
  });
  return candidates.sort((left, right) => right.confidence - left.confidence)[0];
}

export function inferGenericEventSchema(recordSet: CandidateRecordSet): InferredEventSchema {
  const records = recordSet.records.filter(isPlainRecord);
  const rejectionReasons: string[] = [];
  if (records.length < Math.min(5, recordSet.records.length)) {
    rejectionReasons.push("schema requires validation across multiple records");
  }

  const title = bestField(records, "title");
  const url = bestField(records, "url");
  const sourceRecordId = bestField(records, "sourceRecordId");
  const startDate = bestField(records, "startDate");
  const endDate = bestField(records, "endDate");
  const deadline = bestField(records, "deadline");
  const location = bestField(records, "location");
  const mode = bestField(records, "mode");
  const description = bestField(records, "description");
  const status = bestField(records, "status");

  if (!title || title.confidence < 0.5) rejectionReasons.push("title mapping is weak");
  if ((!url || url.confidence < 0.35) && (!sourceRecordId || sourceRecordId.confidence < 0.35)) {
    rejectionReasons.push("records cannot be individually identified");
  }

  const confidence = normalizeRatio(
    (title?.confidence ?? 0) * 0.35 +
      Math.max(url?.confidence ?? 0, sourceRecordId?.confidence ?? 0) * 0.25 +
      (startDate?.confidence ?? deadline?.confidence ?? 0) * 0.15 +
      (location?.confidence ?? 0) * 0.08 +
      (status?.confidence ?? 0) * 0.07 +
      recordSet.confidence * 0.1,
  );

  return {
    recordSetId: recordSet.recordSetId,
    title: title ?? { path: "", confidence: 0, evidence: ["missing"] },
    ...(url && url.confidence >= 0.35 ? { url } : {}),
    ...(startDate && startDate.confidence >= 0.35 ? { startDate } : {}),
    ...(endDate && endDate.confidence >= 0.35 ? { endDate } : {}),
    ...(deadline && deadline.confidence >= 0.35 ? { deadline } : {}),
    ...(location && location.confidence >= 0.35 ? { location } : {}),
    ...(mode && mode.confidence >= 0.35 ? { mode } : {}),
    ...(description && description.confidence >= 0.35 ? { description } : {}),
    ...(status && status.confidence >= 0.35 ? { status } : {}),
    ...(sourceRecordId && sourceRecordId.confidence >= 0.35 ? { sourceRecordId } : {}),
    confidence,
    rejected: rejectionReasons.length > 0,
    rejectionReasons,
  };
}
