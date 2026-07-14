import type {
  CandidateArrayDiagnostic,
  StructuredArtifact,
} from "@/experiments/scraper-v2/types";
import { inferFieldMappings } from "@/experiments/scraper-v2/inferFieldMappings";

const MAX_DEPTH = 8;
const MAX_ARRAY_RECORDS = 100;
const MAX_ARRAYS = 200;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function keySignature(record: Record<string, unknown>): string {
  return Object.keys(record).sort().join("|");
}

function eventVocabularyScore(keys: string[]): number {
  const blob = keys.join(" ");
  let score = 0;
  if (/\b(title|name|hackathon|event)\b/i.test(blob)) score += 0.2;
  if (/\b(url|slug|link|href|id)\b/i.test(blob)) score += 0.2;
  if (/\b(start|end|date|deadline|time)\b/i.test(blob)) score += 0.2;
  if (/\b(status|state|open|upcoming|phase)\b/i.test(blob)) score += 0.15;
  if (/\b(location|city|country|online|venue)\b/i.test(blob)) score += 0.15;
  if (/\b(description|summary|tagline)\b/i.test(blob)) score += 0.1;
  return Math.min(1, score);
}

function uniqueness(records: Array<Record<string, unknown>>): number {
  const values = records.map((record) => {
    const likely = record.id ?? record.slug ?? record.url ?? record.name ?? record.title;
    return typeof likely === "string" || typeof likely === "number"
      ? String(likely)
      : JSON.stringify(record).slice(0, 120);
  });
  return values.length === 0 ? 0 : new Set(values).size / values.length;
}

function diagnosticForArray(
  artifact: StructuredArtifact,
  path: string,
  value: unknown[],
): CandidateArrayDiagnostic | null {
  const inspected = value.slice(0, MAX_ARRAY_RECORDS);
  const records = inspected.filter(isPlainRecord);
  if (records.length < 2) return null;

  const objectRatio = records.length / inspected.length;
  const signatures = records.map(keySignature);
  const mostCommonSignatureCount = Math.max(
    0,
    ...[...new Set(signatures)].map((signature) =>
      signatures.filter((item) => item === signature).length,
    ),
  );
  const repeatedKeyCoverage = records.length === 0 ? 0 : mostCommonSignatureCount / records.length;
  const sampleKeys = [...new Set(records.flatMap((record) => Object.keys(record)))].slice(0, 40);
  const probableFields = inferFieldMappings(records);
  const fieldCoverage =
    [
      probableFields.title,
      probableFields.url ?? probableFields.slug,
      probableFields.startDate ?? probableFields.registrationDeadline,
      probableFields.status,
      probableFields.location,
    ].filter(Boolean).length / 5;
  const uniqueScore = uniqueness(records);
  const vocabularyScore = eventVocabularyScore(sampleKeys);
  if (fieldCoverage < 0.2 && vocabularyScore < 0.2) return null;
  const confidence =
    objectRatio * 0.2 +
    repeatedKeyCoverage * 0.2 +
    fieldCoverage * 0.3 +
    vocabularyScore * 0.2 +
    uniqueScore * 0.1;

  if (confidence < 0.35) return null;

  return {
    artifact: artifact.label,
    artifactKind: artifact.kind,
    path,
    recordCount: value.length,
    repeatedKeyCoverage: Number(repeatedKeyCoverage.toFixed(2)),
    objectRatio: Number(objectRatio.toFixed(2)),
    uniqueness: Number(uniqueScore.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    probableFields,
    sampleKeys,
  };
}

function scanValue(
  artifact: StructuredArtifact,
  value: unknown,
  path: string,
  depth: number,
  out: CandidateArrayDiagnostic[],
): void {
  if (out.length >= MAX_ARRAYS || depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    const diagnostic = diagnosticForArray(artifact, path, value);
    if (diagnostic) out.push(diagnostic);
    for (let index = 0; index < Math.min(value.length, 20); index += 1) {
      scanValue(artifact, value[index], `${path}[${index}]`, depth + 1, out);
    }
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    scanValue(artifact, child, path ? `${path}.${key}` : key, depth + 1, out);
    if (out.length >= MAX_ARRAYS) return;
  }
}

export function discoverRecordArrays(artifacts: StructuredArtifact[]): CandidateArrayDiagnostic[] {
  const out: CandidateArrayDiagnostic[] = [];
  for (const artifact of artifacts) {
    scanValue(artifact, artifact.payload, "", 0, out);
  }
  return out.sort((left, right) => right.confidence - left.confidence);
}

export function readArrayAtPath(payload: unknown, path: string): unknown[] | null {
  let current = payload;
  if (!path) return Array.isArray(current) ? current : null;
  const parts = path.split(".").flatMap((part) => {
    const matches = [...part.matchAll(/([^\[\]]+)|\[(\d+)\]/g)];
    return matches.map((match) => match[1] ?? Number(match[2]));
  });
  for (const part of parts) {
    if (typeof part === "number") {
      if (!Array.isArray(current)) return null;
      current = current[part];
    } else {
      if (!isPlainRecord(current)) return null;
      current = current[part];
    }
  }
  return Array.isArray(current) ? current : null;
}
