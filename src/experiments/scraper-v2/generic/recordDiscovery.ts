import type {
  AcquiredArtifact,
  CandidateRecordSet,
  FieldCoverage,
} from "@/experiments/scraper-v2/generic/types";
import {
  boundedJson,
  cleanText,
  flattenRecordKeys,
  isPlainRecord,
  normalizeRatio,
} from "@/experiments/scraper-v2/generic/valueUtils";

const MAX_DEPTH = 9;
const MAX_ARRAYS = 350;
const MAX_ARRAY_RECORDS = 120;
const MAX_CHILDREN_PER_ARRAY = 24;

export type RecordDiscoveryResult = {
  recordSets: CandidateRecordSet[];
  arraysScanned: number;
  recordsInspected: number;
};

function keySignature(record: Record<string, unknown>): string {
  return Object.keys(record).sort().join("|");
}

function textBlob(record: Record<string, unknown>): string {
  return boundedJson(record, 1_500).toLowerCase();
}

function fieldCoverage(keys: string[], records: Array<Record<string, unknown>>): FieldCoverage {
  const joinedKeys = keys.join(" ");
  const sampleText = records.slice(0, 20).map(textBlob).join(" ");
  return {
    title: /\b(title|name|headline|label)\b/i.test(joinedKeys) ? 1 : /hackathon|challenge|event|summit/i.test(sampleText) ? 0.5 : 0,
    url: /\b(url|href|link|website|site|slug|route|path|permalink|canonical)\b/i.test(joinedKeys) ? 1 : /https?:\/\/|\/[a-z0-9][a-z0-9-/_]+/i.test(sampleText) ? 0.5 : 0,
    date: /\b(start|end|date|deadline|time|opens|closes|begin|finish)\b/i.test(joinedKeys) || /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/i.test(sampleText) ? 1 : 0,
    location: /\b(location|venue|city|country|region|address|online|virtual|hybrid)\b/i.test(joinedKeys) ? 1 : /online|virtual|hybrid|remote/i.test(sampleText) ? 0.5 : 0,
    status: /\b(status|state|phase|open|closed|active|upcoming|past|archived|registration)\b/i.test(joinedKeys) ? 1 : /\b(open|closed|upcoming|ongoing|past)\b/i.test(sampleText) ? 0.5 : 0,
    identity: /\b(id|uuid|uid|slug|handle|key|identifier)\b/i.test(joinedKeys) ? 1 : 0,
  };
}

function uniqueness(records: Array<Record<string, unknown>>): number {
  const values = records.map((record) => {
    const likely =
      record.id ??
      record.uuid ??
      record.uid ??
      record.slug ??
      record.url ??
      record.href ??
      record.name ??
      record.title;
    return cleanText(likely) ?? boundedJson(record, 160);
  });
  return normalizeRatio(values.length === 0 ? 0 : new Set(values).size / values.length);
}

function duplicateRate(records: Array<Record<string, unknown>>): number {
  const values = records.map((record) => boundedJson(record, 220));
  return normalizeRatio(values.length === 0 ? 0 : (values.length - new Set(values).size) / values.length);
}

function eventVocabularyScore(keys: string[], records: Array<Record<string, unknown>>): number {
  const text = `${keys.join(" ")} ${records.slice(0, 20).map(textBlob).join(" ")}`;
  let score = 0;
  if (/\b(hackathon|challenge|event|competition|builder|bounty|grant|summit|conference|demo day)\b/i.test(text)) score += 0.25;
  if (/\b(register|registration|apply|submission|deadline|open|upcoming|ongoing)\b/i.test(text)) score += 0.2;
  if (/\b(start|end|date|time|schedule|period)\b/i.test(text)) score += 0.15;
  if (/\b(location|venue|city|country|online|virtual|hybrid|remote)\b/i.test(text)) score += 0.15;
  if (/\b(prize|track|sponsor|organizer|host|participants)\b/i.test(text)) score += 0.1;
  if (/\b(url|href|slug|website|link|path)\b/i.test(text)) score += 0.15;
  return normalizeRatio(score);
}

function noisePenalty(keys: string[], records: Array<Record<string, unknown>>): { penalty: number; reasons: string[] } {
  const keyText = keys.join(" ").toLowerCase();
  const sampleText = records.slice(0, 20).map(textBlob).join(" ");
  const reasons: string[] = [];
  let penalty = 0;
  if (/\b(nav|navigation|menu|breadcrumb|footer|header)\b/.test(keyText) || (/\blabel\b/.test(keyText) && /\b(open|past|organize|home|about)\b/.test(sampleText) && records.length <= 6)) {
    penalty += 0.35;
    reasons.push("navigation-like array");
  }
  if (/\b(filter|facet|category|tag|sort)\b/.test(keyText)) {
    penalty += 0.25;
    reasons.push("filter/facet-like array");
  }
  if (/\b(sponsor|partner|logo)\b/.test(keyText) && !/\b(date|deadline|registration)\b/.test(keyText)) {
    penalty += 0.25;
    reasons.push("sponsor-only array");
  }
  if (/\b(config|analytics|tracking|experiment|featureflag|feature_flag)\b/.test(keyText)) {
    penalty += 0.3;
    reasons.push("config/analytics array");
  }
  if (records.every((record) => Object.keys(record).every((key) => /image|img|src|alt|width|height|logo/i.test(key)))) {
    penalty += 0.35;
    reasons.push("image-only records");
  }
  return { penalty: normalizeRatio(penalty), reasons };
}

function diagnosticForArray(
  artifact: AcquiredArtifact,
  path: string,
  value: unknown[],
  index: number,
): CandidateRecordSet | null {
  const inspected = value.slice(0, MAX_ARRAY_RECORDS);
  const records = inspected.filter(isPlainRecord);
  if (records.length < 2) return null;
  const objectRatio = records.length / inspected.length;
  if (objectRatio < 0.6) return null;

  const keys = [...new Set(records.flatMap((record) => flattenRecordKeys(record)))];
  const signatures = records.map(keySignature);
  const mostCommonSignatureCount = Math.max(
    0,
    ...[...new Set(signatures)].map((signature) =>
      signatures.filter((item) => item === signature).length,
    ),
  );
  const repeatedKeyCoverage = normalizeRatio(mostCommonSignatureCount / records.length);
  const coverage = fieldCoverage(keys, records);
  const identityCoverage = Math.max(coverage.identity, coverage.url);
  const fieldScore = normalizeRatio(
    coverage.title * 0.25 +
      coverage.url * 0.2 +
      coverage.date * 0.2 +
      coverage.location * 0.1 +
      coverage.status * 0.1 +
      identityCoverage * 0.15,
  );
  const vocabularyScore = eventVocabularyScore(keys, records);
  const uniqueScore = uniqueness(records);
  const { penalty, reasons } = noisePenalty(keys, records);
  const structuralScore = normalizeRatio(
    objectRatio * 0.3 + repeatedKeyCoverage * 0.25 + uniqueScore * 0.25 + Math.min(records.length / 10, 1) * 0.2,
  );
  const eventScore = normalizeRatio(vocabularyScore * 0.45 + fieldScore * 0.45 + identityCoverage * 0.1 - penalty);
  const confidence = normalizeRatio(structuralScore * 0.45 + eventScore * 0.55 - penalty * 0.4);
  if (confidence < 0.32 || eventScore < 0.2) return null;

  return {
    recordSetId: `${artifact.artifactId}:${index}`,
    artifactId: artifact.artifactId,
    artifactKind: artifact.kind,
    path,
    records: value,
    inspectedRecords: records.length,
    structuralScore,
    eventScore,
    fieldCoverage: coverage,
    duplicateRate: duplicateRate(records),
    confidence,
    sampleKeys: keys.slice(0, 60),
    rejectionReasons: reasons,
  };
}

function scanValue(input: {
  artifact: AcquiredArtifact;
  value: unknown;
  path: string;
  depth: number;
  out: CandidateRecordSet[];
  counters: { arraysScanned: number; recordsInspected: number };
}): void {
  if (input.out.length >= MAX_ARRAYS || input.depth > MAX_DEPTH) return;
  if (Array.isArray(input.value)) {
    input.counters.arraysScanned += 1;
    input.counters.recordsInspected += Math.min(input.value.length, MAX_ARRAY_RECORDS);
    const diagnostic = diagnosticForArray(
      input.artifact,
      input.path,
      input.value,
      input.counters.arraysScanned,
    );
    if (diagnostic) input.out.push(diagnostic);
    for (let index = 0; index < Math.min(input.value.length, MAX_CHILDREN_PER_ARRAY); index += 1) {
      scanValue({
        ...input,
        value: input.value[index],
        path: `${input.path}[${index}]`,
        depth: input.depth + 1,
      });
    }
    return;
  }
  if (!isPlainRecord(input.value)) return;
  for (const [key, child] of Object.entries(input.value)) {
    scanValue({
      ...input,
      value: child,
      path: input.path ? `${input.path}.${key}` : key,
      depth: input.depth + 1,
    });
    if (input.out.length >= MAX_ARRAYS) return;
  }
}

export function discoverGenericRecordSets(artifacts: AcquiredArtifact[]): RecordDiscoveryResult {
  const out: CandidateRecordSet[] = [];
  const counters = { arraysScanned: 0, recordsInspected: 0 };
  for (const artifact of artifacts) {
    if (artifact.kind === "html" || artifact.kind === "dom_snapshot") continue;
    scanValue({
      artifact,
      value: artifact.payload,
      path: "",
      depth: 0,
      out,
      counters,
    });
  }
  return {
    recordSets: out.sort((left, right) => right.confidence - left.confidence),
    arraysScanned: counters.arraysScanned,
    recordsInspected: counters.recordsInspected,
  };
}
