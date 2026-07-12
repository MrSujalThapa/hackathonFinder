import type { CandidateDetail, CandidateEvidence } from "@/core/candidates/types";
import type { SearchProvider } from "@/lib/search/types";

export type CandidateAnswerSource = {
  url: string;
  label: string;
};

export type FactCertainty = "confirmed" | "inferred" | "conflicting" | "unknown";

export type CandidateQuestionAnswer = {
  answer: string;
  confidence: "low" | "medium" | "high";
  certainty: FactCertainty;
  sources: CandidateAnswerSource[];
  liveVerification: boolean;
  updatedFields: Partial<CandidateDetail>;
};

export type AnswerCandidateQuestionOptions = {
  searchProvider?: SearchProvider | null;
  now?: Date;
  /** Hard cap — Ask never runs more than this many search calls. */
  maxSearchCalls?: number;
};

function evidenceSources(candidate: CandidateDetail): CandidateAnswerSource[] {
  const sources = candidate.evidence
    .map((item) => ({
      url: item.url,
      label: item.title ?? item.type.replace(/_/g, " "),
    }))
    .filter((item): item is CandidateAnswerSource => Boolean(item.url));
  return sources.slice(0, 6);
}

function primarySources(candidate: CandidateDetail): CandidateAnswerSource[] {
  const out: CandidateAnswerSource[] = [];
  if (candidate.officialUrl) {
    out.push({ url: candidate.officialUrl, label: "Official event page" });
  }
  if (candidate.applyUrl) {
    out.push({ url: candidate.applyUrl, label: "Application page" });
  }
  if (out.length === 0) return evidenceSources(candidate);
  return out;
}

function evidenceText(evidence: CandidateEvidence[]): string {
  return evidence
    .map((item) => [item.title, item.snippet].filter(Boolean).join(" "))
    .join("\n");
}

function mentionFromEvidence(
  evidence: CandidateEvidence[],
  patterns: RegExp[],
): string | null {
  const text = evidenceText(evidence);
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim();
  }
  return null;
}

function withCertainty(
  answer: string,
  certainty: FactCertainty,
  confidence: CandidateQuestionAnswer["confidence"],
  sources: CandidateAnswerSource[],
  liveVerification = false,
): CandidateQuestionAnswer {
  const prefix =
    certainty === "confirmed"
      ? ""
      : certainty === "inferred"
        ? "Inferred from available evidence: "
        : certainty === "conflicting"
          ? "Evidence may conflict: "
          : "Unknown from stored evidence: ";
  return {
    answer: certainty === "confirmed" || certainty === "unknown" ? answer : `${prefix}${answer}`,
    confidence,
    certainty,
    sources,
    liveVerification,
    updatedFields: {},
  };
}

function needsResearch(question: string, local: CandidateQuestionAnswer): boolean {
  if (local.certainty === "confirmed" && local.confidence === "high") return false;
  if (local.certainty === "unknown" || local.confidence === "low") return true;
  // Judging / build / uncertain prompts benefit from extra context when weak
  if (/judging|criteria|build|uncertain|still unclear/i.test(question)) {
    return local.confidence !== "high";
  }
  return false;
}

async function researchOnce(
  candidate: CandidateDetail,
  question: string,
  provider: SearchProvider,
): Promise<{ snippet: string; sources: CandidateAnswerSource[] } | null> {
  const query = [
    candidate.name,
    question.replace(/\?/g, ""),
    candidate.city ?? candidate.location ?? "",
    "hackathon",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 160);

  const results = await provider.search({
    query,
    maxResults: 3,
    timeoutMs: 8_000,
  });
  if (!results.length) return null;

  const sources = results
    .filter((item) => item.url)
    .slice(0, 3)
    .map((item) => ({
      url: item.url,
      label: item.title || item.source || "Search result",
    }));

  const snippet = results
    .map((item) => `${item.title}: ${item.snippet}`)
    .join(" | ")
    .slice(0, 500);

  return { snippet, sources };
}

function answerLocally(
  candidate: CandidateDetail,
  question: string,
  now: Date,
): CandidateQuestionAnswer {
  const lower = question.toLowerCase();
  const sources = primarySources(candidate);
  const today = now.toISOString().slice(0, 10);

  if (/uncertain|still unclear|what.*missing|don't know|do not know/.test(lower)) {
    const gaps: string[] = [];
    if (!candidate.deadline) gaps.push("application deadline");
    if (!candidate.eligibility) gaps.push("eligibility");
    if (!candidate.prize) gaps.push("prizes");
    if (!candidate.applyUrl) gaps.push("application link");
    if (!candidate.mode || candidate.mode === "unknown") gaps.push("event mode");
    if (!candidate.startDate) gaps.push("event start date");
    return withCertainty(
      gaps.length
        ? `Still uncertain: ${gaps.join(", ")}.`
        : "Core fields look populated, but fine-print details (judging, team rules) may still need the official page.",
      gaps.length ? "unknown" : "inferred",
      gaps.length ? "medium" : "low",
      sources,
    );
  }

  if (/deadline|registration.*(close|due)|apply.*by/.test(lower)) {
    if (candidate.deadline) {
      const differs =
        candidate.startDate &&
        candidate.deadline !== candidate.startDate &&
        /differ|different|vs|versus|event date/.test(lower);
      return withCertainty(
        differs
          ? `Yes — the application deadline (${candidate.deadline}) differs from the event start (${candidate.startDate}).`
          : `The application deadline is ${candidate.deadline}.`,
        "confirmed",
        "high",
        sources,
      );
    }
    const hint = mentionFromEvidence(candidate.evidence, [
      /deadline[:\s]+[^.]{4,80}/i,
    ]);
    return withCertainty(
      hint
        ? `Found a deadline hint that needs review: ${hint}.`
        : "No verified application deadline is stored.",
      hint ? "inferred" : "unknown",
      hint ? "medium" : "low",
      sources,
    );
  }

  if (/differ.*deadline|deadline.*differ|deadline.*event date/.test(lower)) {
    if (candidate.deadline && candidate.startDate) {
      const same = candidate.deadline === candidate.startDate;
      return withCertainty(
        same
          ? `The stored deadline and start date are the same (${candidate.deadline}).`
          : `Yes. Deadline ${candidate.deadline}; event starts ${candidate.startDate}.`,
        "confirmed",
        "high",
        sources,
      );
    }
    return withCertainty(
      "Cannot compare deadline and event date — one or both are missing.",
      "unknown",
      "low",
      sources,
    );
  }

  if (/fully remote|remote|online|virtual|in[- ]person|hybrid/.test(lower)) {
    if (candidate.mode === "online") {
      return withCertainty(
        "Yes — stored mode is online/remote.",
        "confirmed",
        "high",
        sources,
      );
    }
    if (candidate.mode === "in-person") {
      return withCertainty(
        "No — stored mode is in-person.",
        "confirmed",
        "high",
        sources,
      );
    }
    if (candidate.mode === "hybrid") {
      return withCertainty(
        "Stored mode is hybrid (not fully remote).",
        "confirmed",
        "high",
        sources,
      );
    }
    const textRemote = /remote|online|virtual/i.test(
      [candidate.location, candidate.city, candidate.country, candidate.description]
        .filter(Boolean)
        .join(" "),
    );
    return withCertainty(
      textRemote
        ? "Location text suggests remote/online, but mode is not confirmed."
        : "Event mode is not clearly verified.",
      textRemote ? "inferred" : "unknown",
      textRemote ? "medium" : "low",
      sources,
    );
  }

  if (/where|location|venue|city/.test(lower)) {
    const place =
      [candidate.city, candidate.country].filter(Boolean).join(", ") ||
      candidate.location;
    return withCertainty(
      place ? `Listed location: ${place}.` : "Location is not verified in stored data.",
      place ? "confirmed" : "unknown",
      place ? "high" : "low",
      sources,
    );
  }

  if (/eligible|eligibility|student|who can|waterloo/.test(lower)) {
    if (candidate.eligibility) {
      const waterlooAsk = /waterloo/i.test(lower);
      const mentionsStudent = /student/i.test(candidate.eligibility);
      if (waterlooAsk && mentionsStudent) {
        return withCertainty(
          `Eligibility text says: ${candidate.eligibility}. That likely includes Waterloo students, but confirm on the official page.`,
          "inferred",
          "medium",
          sources,
        );
      }
      return withCertainty(
        `Eligibility: ${candidate.eligibility}.`,
        "confirmed",
        "high",
        sources,
      );
    }
    return withCertainty(
      "Eligibility is not clearly verified in stored candidate data.",
      "unknown",
      "low",
      sources,
    );
  }

  if (/team|solo|individual/.test(lower)) {
    const hint = mentionFromEvidence(candidate.evidence, [
      /team size[:\s]+[^.]{2,80}/i,
      /teams? of [^.]{2,60}/i,
      /solo|individual participants?|teams? (required|optional)/i,
    ]);
    if (hint) {
      return withCertainty(hint, "inferred", "medium", sources);
    }
    return withCertainty(
      "Team requirements are not verified in stored evidence.",
      "unknown",
      "low",
      sources,
    );
  }

  if (/prize|sponsor|award/.test(lower)) {
    return withCertainty(
      candidate.prize
        ? `Prize/sponsor note: ${candidate.prize}.`
        : "Prizes are not verified in stored candidate data.",
      candidate.prize ? "confirmed" : "unknown",
      candidate.prize ? "high" : "low",
      sources,
    );
  }

  if (/judging|criteria|how.*judged/.test(lower)) {
    const hint = mentionFromEvidence(candidate.evidence, [
      /judging[^.]{0,120}/i,
      /criteria[^.]{0,120}/i,
    ]);
    return withCertainty(
      hint ?? "Judging criteria are not verified in stored evidence.",
      hint ? "inferred" : "unknown",
      hint ? "medium" : "low",
      sources,
    );
  }

  if (/summarize|what.*(build|make|create)|need to build/.test(lower)) {
    const parts = [
      candidate.summary,
      candidate.description,
      candidate.themes.length ? `Themes: ${candidate.themes.join(", ")}` : null,
    ].filter(Boolean);
    return withCertainty(
      parts.length
        ? parts.join(" ")
        : "Not enough stored description to summarize what to build.",
      parts.length ? "inferred" : "unknown",
      parts.length ? "medium" : "low",
      sources,
    );
  }

  if (/open|registration still|still open/.test(lower)) {
    if (!candidate.deadline) {
      return withCertainty(
        "Registration status is uncertain because no verified deadline is stored.",
        "unknown",
        "low",
        sources,
      );
    }
    const open = candidate.deadline >= today;
    return withCertainty(
      open
        ? `Registration appears open based on deadline ${candidate.deadline}.`
        : `Registration appears closed based on deadline ${candidate.deadline}.`,
      "inferred",
      "medium",
      sources,
    );
  }

  if (/official.*(application|apply)|application page|apply link/.test(lower)) {
    const url = candidate.applyUrl ?? candidate.officialUrl;
    return withCertainty(
      url
        ? `Best application link on file: ${url}.`
        : "No verified application link is stored.",
      candidate.applyUrl ? "confirmed" : candidate.officialUrl ? "inferred" : "unknown",
      candidate.applyUrl ? "high" : candidate.officialUrl ? "medium" : "low",
      url
        ? [
            {
              url,
              label: candidate.applyUrl ? "Application page" : "Official event page",
            },
          ]
        : sources,
    );
  }

  if (/why.*match|preferences|fit/.test(lower)) {
    return withCertainty(
      candidate.whyMatch.length
        ? candidate.whyMatch.join("; ")
        : "No specific match reasons are stored.",
      candidate.whyMatch.length ? "confirmed" : "unknown",
      candidate.whyMatch.length ? "high" : "low",
      sources,
    );
  }

  // Generic grounded fallback using description / evidence — never invent.
  const blob = [
    candidate.summary,
    candidate.description,
    evidenceText(candidate.evidence).slice(0, 400),
  ]
    .filter(Boolean)
    .join(" ");
  if (blob) {
    return withCertainty(
      `I can only confirm what is already stored. Relevant notes: ${blob.slice(0, 320)}${blob.length > 320 ? "…" : ""}`,
      "inferred",
      "low",
      sources,
    );
  }

  return withCertainty(
    "I could not verify an answer from the stored candidate evidence.",
    "unknown",
    "low",
    sources,
  );
}

export async function answerCandidateQuestion(
  candidate: CandidateDetail,
  question: string,
  options: AnswerCandidateQuestionOptions = {},
): Promise<CandidateQuestionAnswer> {
  const now = options.now ?? new Date();
  const local = answerLocally(candidate, question.trim(), now);
  const maxSearch = options.maxSearchCalls ?? 1;

  if (
    !options.searchProvider ||
    maxSearch < 1 ||
    !needsResearch(question, local)
  ) {
    return local;
  }

  try {
    const researched = await researchOnce(
      candidate,
      question,
      options.searchProvider,
    );
    if (!researched) return { ...local, liveVerification: false };

    const mergedSources = [
      ...local.sources,
      ...researched.sources.filter(
        (source) => !local.sources.some((existing) => existing.url === source.url),
      ),
    ].slice(0, 6);

    if (local.certainty === "unknown") {
      return {
        answer: `Live search found related notes (still verify on the official page): ${researched.snippet}`,
        confidence: "low",
        certainty: "inferred",
        sources: mergedSources,
        liveVerification: true,
        updatedFields: {},
      };
    }

    return {
      ...local,
      answer: `${local.answer} Live search addendum: ${researched.snippet}`,
      sources: mergedSources,
      liveVerification: true,
      confidence: local.confidence === "high" ? "medium" : local.confidence,
      certainty: local.certainty === "confirmed" ? "inferred" : local.certainty,
    };
  } catch {
    return { ...local, liveVerification: false };
  }
}

/** Suggested Ask shortcuts from missing/uncertain fields — not an allowlist. */
export function suggestedCandidateQuestions(
  candidate: CandidateDetail,
): string[] {
  const suggestions: string[] = [];
  if (!candidate.deadline) {
    suggestions.push("What is the application deadline?");
  } else if (candidate.startDate && candidate.deadline !== candidate.startDate) {
    suggestions.push("Does the application deadline differ from the event date?");
  }
  if (!candidate.mode || candidate.mode === "unknown") {
    suggestions.push("Is the event fully remote?");
  } else if (candidate.mode !== "online") {
    suggestions.push("Is the event fully remote?");
  }
  if (!candidate.eligibility) {
    suggestions.push("Am I eligible as a Waterloo student?");
  } else {
    suggestions.push("Am I eligible as a Waterloo student?");
  }
  if (!candidate.prize) suggestions.push("What are the prizes?");
  suggestions.push("Are teams required?");
  suggestions.push("What are the judging criteria?");
  suggestions.push("What information is still uncertain?");
  suggestions.push("Summarize what I would need to build.");

  const unique: string[] = [];
  for (const item of suggestions) {
    if (!unique.includes(item)) unique.push(item);
    if (unique.length >= 6) break;
  }
  return unique;
}
