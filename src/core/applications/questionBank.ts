import type { QuestionBankEntry } from "@/core/applications/types";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

function similarity(left: string, right: string): number {
  const a = new Set(normalize(left).split(" ").filter(Boolean));
  const b = new Set(normalize(right).split(" ").filter(Boolean));
  const common = [...a].filter((word) => b.has(word)).length;
  return a.size + b.size === 0 ? 0 : (2 * common) / (a.size + b.size);
}

export function matchQuestionBank(question: string, entries: QuestionBankEntry[]): QuestionBankEntry | null {
  const normalized = normalize(question);
  const exact = entries.find((entry) => [entry.canonicalQuestion, ...entry.aliases].some((candidate) => normalize(candidate) === normalized));
  if (exact) return exact;
  const ranked = entries.map((entry) => ({ entry, score: Math.max(...[entry.canonicalQuestion, ...entry.aliases].map((candidate) => similarity(question, candidate)))})).sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 0.82 && (ranked[1]?.score ?? 0) < ranked[0].score - 0.08 ? ranked[0].entry : null;
}
