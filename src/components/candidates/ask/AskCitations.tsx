import type { CandidateAnswerSource } from "@/core/candidateAskDecision";

const MAX_CITATIONS = 3;
const LABEL_MAX = 42;

const PREFERRED_LABEL = /official|apply|registration|event page|homepage/i;

function truncateLabel(label: string): string {
  const trimmed = label.trim() || "Source";
  if (trimmed.length <= LABEL_MAX) return trimmed;
  return `${trimmed.slice(0, LABEL_MAX - 1)}…`;
}

function rankSource(source: CandidateAnswerSource): number {
  if (PREFERRED_LABEL.test(source.label)) return 0;
  if (/official|apply/i.test(source.url)) return 1;
  return 2;
}

/** Dedupe by URL, prefer official/apply labels, cap at 1–3. */
export function selectCompactCitations(
  links: CandidateAnswerSource[],
): CandidateAnswerSource[] {
  const seen = new Set<string>();
  const unique: CandidateAnswerSource[] = [];
  for (const link of links) {
    const url = link.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push({ url, label: link.label?.trim() || "Source" });
  }
  return unique
    .sort((a, b) => rankSource(a) - rankSource(b))
    .slice(0, MAX_CITATIONS);
}

export function AskCitations({
  links,
  answerId,
}: {
  links: CandidateAnswerSource[];
  answerId: string;
}) {
  const citations = selectCompactCitations(links);
  if (citations.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {citations.map((source) => (
        <a
          key={`${answerId}-${source.url}`}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hf-link-quiet"
        >
          {truncateLabel(source.label)}
        </a>
      ))}
    </div>
  );
}
