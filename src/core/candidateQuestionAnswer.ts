import type { CandidateDetail, CandidateEvidence } from "@/core/candidates/types";
import {
  classifyCandidateQuestion,
  formatDecisionAnswer,
  parseDecisionRecommendation,
  parseFactualAnswerPayload,
  type CandidateAnswerSource,
  type DecisionRecommendation,
  type FactCertainty,
  type FactualAnswerPayload,
  type QuestionKind,
  DECISION_LEVELS,
  CONFIDENCE_LEVELS,
  REASON_BASIS_LEVELS,
} from "@/core/candidateAskDecision";
import {
  buildAskObservabilityMeta,
  type AskObservabilityMeta,
} from "@/core/askObservability";
import { getServerEnv } from "@/config/env";
import {
  createLlmProviderOptional,
  generateJson,
  jsonSchemaResponseFormat,
  DEFAULT_MAX_OUTPUT_TOKENS,
  type LlmProvider,
} from "@/lib/llm";
import type { SearchProvider } from "@/lib/search/types";

export type {
  CandidateAnswerSource,
  DecisionRecommendation,
  FactCertainty,
  FactualAnswerPayload,
  QuestionKind,
} from "@/core/candidateAskDecision";
export {
  classifyCandidateQuestion,
  formatDecisionAnswer,
  parseDecisionRecommendation,
  parseFactualAnswerPayload,
  readPersistedAskPayload,
  reasonText,
  asDecisionReasons,
} from "@/core/candidateAskDecision";
export type { AskObservabilityMeta } from "@/core/askObservability";

export type CandidateQuestionAnswer = {
  answer: string;
  confidence: "low" | "medium" | "high";
  certainty: FactCertainty;
  sources: CandidateAnswerSource[];
  liveVerification: boolean;
  updatedFields: Partial<CandidateDetail>;
  kind: QuestionKind;
  decision?: DecisionRecommendation;
  factual?: FactualAnswerPayload;
  meta?: AskObservabilityMeta;
};

export type AnswerCandidateQuestionOptions = {
  searchProvider?: SearchProvider | null;
  llmProvider?: LlmProvider | null;
  now?: Date;
  /** Hard cap — Ask never runs more than this many search calls. */
  maxSearchCalls?: number;
};

const ASK_DEFAULT_MAX_OUTPUT_TOKENS = Math.max(DEFAULT_MAX_OUTPUT_TOKENS, 1200);

function resolveAskMaxOutputTokens(): number {
  try {
    const raw = getServerEnv().LLM_MAX_OUTPUT_TOKENS;
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 256) return parsed;
    }
  } catch {
    // Env may be unavailable in some unit-test contexts.
  }
  return ASK_DEFAULT_MAX_OUTPUT_TOKENS;
}

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

function buildFactual(
  answer: string,
  certainty: FactCertainty,
  sources: CandidateAnswerSource[],
  supportingFacts: string[] = [],
): FactualAnswerPayload {
  return {
    answer,
    certainty,
    supportingFacts: supportingFacts.filter(Boolean).slice(0, 8),
    citations: sources.slice(0, 6),
  };
}

function withCertainty(
  answer: string,
  certainty: FactCertainty,
  confidence: CandidateQuestionAnswer["confidence"],
  sources: CandidateAnswerSource[],
  supportingFacts: string[] = [],
  liveVerification = false,
): CandidateQuestionAnswer {
  const prefix =
    certainty === "confirmed"
      ? ""
      : certainty === "inferred"
        ? "Inferred from available evidence: "
        : certainty === "conflicting"
          ? "Evidence may conflict: "
          : "";
  const displayAnswer =
    certainty === "confirmed" || certainty === "unknown"
      ? answer
      : `${prefix}${answer}`;
  const factual = buildFactual(displayAnswer, certainty, sources, supportingFacts);
  return {
    answer: displayAnswer,
    confidence,
    certainty,
    sources,
    liveVerification,
    updatedFields: {},
    kind: "factual",
    factual,
  };
}

function isDateScheduleQuestion(lower: string): boolean {
  return (
    /\b(dates?|schedule|when|timing|starts?|ends?|begin|beginning)\b/i.test(
      lower,
    ) ||
    /^(date|when|schedule)\??$/i.test(lower.trim()) ||
    /\bevent\s+dates?\b/i.test(lower)
  );
}

function formatStoredDateAnswer(candidate: CandidateDetail): {
  answer: string;
  supportingFacts: string[];
  hasAny: boolean;
} {
  const facts: string[] = [];
  const parts: string[] = [];

  if (candidate.startDate && candidate.endDate) {
    if (candidate.startDate === candidate.endDate) {
      parts.push(`The event is on ${candidate.startDate}.`);
    } else {
      parts.push(
        `The event runs ${candidate.startDate} to ${candidate.endDate}.`,
      );
    }
    facts.push(`startDate: ${candidate.startDate}`);
    facts.push(`endDate: ${candidate.endDate}`);
  } else if (candidate.startDate) {
    parts.push(`The event starts ${candidate.startDate}.`);
    facts.push(`startDate: ${candidate.startDate}`);
    if (candidate.endDate) {
      parts.push(`It ends ${candidate.endDate}.`);
      facts.push(`endDate: ${candidate.endDate}`);
    }
  } else if (candidate.endDate) {
    parts.push(`The event ends ${candidate.endDate}.`);
    facts.push(`endDate: ${candidate.endDate}`);
  }

  if (candidate.deadline) {
    parts.push(`Application deadline: ${candidate.deadline}.`);
    facts.push(`deadline: ${candidate.deadline}`);
  }

  return {
    answer: parts.join(" ").trim(),
    supportingFacts: facts,
    hasAny: facts.length > 0,
  };
}

function availableFieldHints(candidate: CandidateDetail): string[] {
  const hints: string[] = [];
  if (candidate.deadline) hints.push("deadline");
  if (candidate.startDate || candidate.endDate) hints.push("event dates");
  if (candidate.mode && candidate.mode !== "unknown") hints.push("mode");
  if (candidate.eligibility) hints.push("eligibility");
  if (candidate.prize) hints.push("prizes");
  if (candidate.applyUrl || candidate.officialUrl) hints.push("application link");
  return hints;
}

function needsResearch(
  question: string,
  local: CandidateQuestionAnswer,
): boolean {
  // Confirmed high-confidence store answers never trigger SERP.
  if (local.certainty === "confirmed" && local.confidence === "high") {
    return false;
  }
  // Date/schedule answered from stored fields — do not research.
  if (isDateScheduleQuestion(question.toLowerCase()) && local.factual?.supportingFacts.length) {
    return false;
  }
  if (local.certainty === "unknown" || local.confidence === "low") return true;
  if (/judging|criteria|build|uncertain|still unclear/i.test(question)) {
    return local.confidence !== "high";
  }
  return false;
}

async function researchOnce(
  candidate: CandidateDetail,
  question: string,
  provider: SearchProvider,
): Promise<{ notes: string; sources: CandidateAnswerSource[] } | null> {
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

  // Internal notes only — never pasted into user-visible answer.
  const notes = results
    .map((item) => `${item.title}: ${item.snippet}`)
    .join("\n")
    .slice(0, 800);

  return { notes, sources };
}

function factualSynthesisSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["answer", "certainty", "supportingFacts", "citations"],
    properties: {
      answer: { type: "string" },
      certainty: {
        type: "string",
        enum: ["confirmed", "inferred", "conflicting", "unknown"],
      },
      supportingFacts: { type: "array", items: { type: "string" } },
      citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["url", "label"],
          properties: {
            url: { type: "string" },
            label: { type: "string" },
          },
        },
      },
    },
  };
}

async function synthesizeFactualResearch(params: {
  candidate: CandidateDetail;
  question: string;
  local: CandidateQuestionAnswer;
  researchNotes: string;
  researchSources: CandidateAnswerSource[];
  llmProvider: LlmProvider;
}): Promise<CandidateQuestionAnswer | null> {
  const { candidate, question, local, researchNotes, researchSources, llmProvider } =
    params;
  const allowed = [...local.sources, ...researchSources].slice(0, 6);

  try {
    const { value } = await generateJson(
      llmProvider,
      {
        messages: [
          {
            role: "system",
            content: [
              "Answer a factual hackathon question in 1–3 short sentences.",
              "Use stored candidate facts first; use research notes only to fill gaps.",
              "Never paste raw search snippets or title:snippet dumps into the answer.",
              "Do not invent deadlines, dates, or eligibility.",
              "Cite only allowed URLs.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Question: ${question}`,
              "",
              `Stored local answer (${local.certainty}): ${local.answer}`,
              "",
              "Candidate fields:",
              candidateBrief(candidate),
              "",
              "Internal research notes (do not paste verbatim):",
              researchNotes || "(none)",
              "",
              "Allowed citation URLs:",
              allowed.map((s) => `${s.label}: ${s.url}`).join("\n") || "none",
            ].join("\n"),
          },
        ],
        temperature: 0.1,
        maxOutputTokens: Math.min(resolveAskMaxOutputTokens(), 600),
        responseFormat: jsonSchemaResponseFormat({
          name: "hackathon_factual_synthesis",
          schema: factualSynthesisSchema(),
        }),
        metadata: { feature: "candidate-ask-factual-synthesis" },
      },
      (raw) => {
        const parsed = parseFactualAnswerPayload(raw, allowed);
        if (!parsed) {
          throw new Error("Invalid factual synthesis payload");
        }
        // Guard: reject answers that still look like SERP dumps.
        if (
          /live search addendum|title:\s*.+\|/i.test(parsed.answer) ||
          parsed.answer.length > 600
        ) {
          throw new Error("Factual synthesis looked like a snippet dump");
        }
        return parsed;
      },
    );

    const certainty = value.certainty;
    const confidence: CandidateQuestionAnswer["confidence"] =
      certainty === "confirmed"
        ? "high"
        : certainty === "inferred"
          ? "medium"
          : "low";

    return {
      answer: value.answer,
      confidence,
      certainty,
      sources: value.citations.length ? value.citations : allowed,
      liveVerification: true,
      updatedFields: {},
      kind: "factual",
      factual: {
        ...value,
        citations: value.citations.length ? value.citations : allowed,
      },
    };
  } catch {
    return null;
  }
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
      gaps.map((g) => `missing: ${g}`),
    );
  }

  if (isDateScheduleQuestion(lower)) {
    const dated = formatStoredDateAnswer(candidate);
    if (dated.hasAny) {
      return withCertainty(
        dated.answer,
        "confirmed",
        "high",
        sources,
        dated.supportingFacts,
      );
    }
    return withCertainty(
      "No verified event dates or application deadline are stored yet.",
      "unknown",
      "low",
      sources,
      [],
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
        [
          `deadline: ${candidate.deadline}`,
          candidate.startDate ? `startDate: ${candidate.startDate}` : "",
        ].filter(Boolean),
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
      hint ? [`evidence hint: ${hint}`] : [],
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
        [
          `deadline: ${candidate.deadline}`,
          `startDate: ${candidate.startDate}`,
        ],
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
        ["mode: online"],
      );
    }
    if (candidate.mode === "in-person") {
      return withCertainty(
        "No — stored mode is in-person.",
        "confirmed",
        "high",
        sources,
        ["mode: in-person"],
      );
    }
    if (candidate.mode === "hybrid") {
      return withCertainty(
        "Stored mode is hybrid (not fully remote).",
        "confirmed",
        "high",
        sources,
        ["mode: hybrid"],
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
      place ? [`location: ${place}`] : [],
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
          [`eligibility: ${candidate.eligibility}`],
        );
      }
      return withCertainty(
        `Eligibility: ${candidate.eligibility}.`,
        "confirmed",
        "high",
        sources,
        [`eligibility: ${candidate.eligibility}`],
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
      return withCertainty(hint, "inferred", "medium", sources, [
        `evidence: ${hint}`,
      ]);
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
      candidate.prize ? [`prize: ${candidate.prize}`] : [],
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
      hint ? [`evidence: ${hint}`] : [],
    );
  }

  if (/summarize|what.*(build|make|create)|need to build/.test(lower)) {
    const parts = [
      candidate.summary,
      candidate.description,
      candidate.themes.length ? `Themes: ${candidate.themes.join(", ")}` : null,
    ].filter(Boolean);
    const text = parts.length
      ? parts.join(" ").slice(0, 420)
      : "Not enough stored description to summarize what to build.";
    return withCertainty(
      text,
      parts.length ? "inferred" : "unknown",
      parts.length ? "medium" : "low",
      sources,
      candidate.themes.length
        ? [`themes: ${candidate.themes.join(", ")}`]
        : [],
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
      [`deadline: ${candidate.deadline}`],
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
      url ? [`apply: ${url}`] : [],
    );
  }

  if (/why.*match|preferences|fit/.test(lower) && !/\bshould\b/.test(lower)) {
    return withCertainty(
      candidate.whyMatch.length
        ? candidate.whyMatch.join("; ")
        : "No specific match reasons are stored.",
      candidate.whyMatch.length ? "confirmed" : "unknown",
      candidate.whyMatch.length ? "high" : "low",
      sources,
      candidate.whyMatch.slice(0, 4),
    );
  }

  // Underspecified catch-all: no blob dump of summary/evidence.
  const hints = availableFieldHints(candidate);
  return withCertainty(
    hints.length
      ? `I could not match that to a specific stored field. You can ask about ${hints.slice(0, 4).join(", ")}.`
      : "I could not verify an answer from the stored candidate evidence.",
    "unknown",
    "low",
    sources,
    hints.map((h) => `askable: ${h}`),
  );
}

function candidateBrief(candidate: CandidateDetail): string {
  return [
    `Name: ${candidate.name}`,
    `Status: ${candidate.status}`,
    `Mode: ${candidate.mode ?? "unknown"}`,
    `Location: ${[candidate.city, candidate.country].filter(Boolean).join(", ") || candidate.location || "unknown"}`,
    `Dates: ${candidate.startDate ?? "?"} – ${candidate.endDate ?? "?"}`,
    `Deadline: ${candidate.deadline ?? "unknown"}`,
    `Eligibility: ${candidate.eligibility ?? "unknown"}`,
    `Prize: ${candidate.prize ?? "unknown"}`,
    `Themes: ${candidate.themes.join(", ") || "none"}`,
    `Summary: ${candidate.summary ?? ""}`,
    `Description: ${(candidate.description ?? "").slice(0, 600)}`,
    `Why match: ${candidate.whyMatch.join("; ") || "none stored"}`,
    `Red flags: ${candidate.redFlags.join("; ") || "none stored"}`,
    `Official: ${candidate.officialUrl ?? "none"}`,
    `Apply: ${candidate.applyUrl ?? "none"}`,
    `Evidence: ${evidenceText(candidate.evidence).slice(0, 500) || "none"}`,
  ].join("\n");
}

function decisionJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "recommendation",
      "headline",
      "summary",
      "reasons",
      "concerns",
      "missingInformation",
      "nextStep",
      "confidence",
      "citations",
    ],
    properties: {
      recommendation: { type: "string", enum: [...DECISION_LEVELS] },
      headline: { type: "string" },
      summary: { type: "string" },
      reasons: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "basis"],
          properties: {
            text: { type: "string" },
            basis: { type: "string", enum: [...REASON_BASIS_LEVELS] },
          },
        },
      },
      concerns: { type: "array", items: { type: "string" } },
      missingInformation: { type: "array", items: { type: "string" } },
      nextStep: { type: "string" },
      confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
      citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["url", "label"],
          properties: {
            url: { type: "string" },
            label: { type: "string" },
          },
        },
      },
    },
  };
}

async function answerDecisionQuestion(
  candidate: CandidateDetail,
  question: string,
  llmProvider: LlmProvider | null | undefined,
): Promise<CandidateQuestionAnswer> {
  const sources = primarySources(candidate);
  const started = Date.now();
  const provider =
    llmProvider === undefined
      ? createLlmProviderOptional({ instrument: false })
      : llmProvider;

  if (!provider) {
    return {
      answer:
        "I can only give advisory recommendations when an LLM provider is configured. Ask a factual question (deadline, eligibility, mode) or configure LLM_PROVIDER.",
      confidence: "low",
      certainty: "unknown",
      sources,
      liveVerification: false,
      updatedFields: {},
      kind: "decision",
      meta: buildAskObservabilityMeta({
        questionType: "decision",
        llmAttempted: false,
        llmSucceeded: false,
        fallbackUsed: true,
        latencyMs: Date.now() - started,
        researchCalls: 0,
      }),
    };
  }

  try {
    const { value, response } = await generateJson(
      provider,
      {
        messages: [
          {
            role: "system",
            content: [
              "You advise on whether to attend a hackathon.",
              "Owner preference storage may be unavailable — state clearly when advice is generic (basis: generic).",
              "Recommend directly. Write a short summary. Explain why with reasons that each include text + basis (verified|inferred|generic|missing).",
              "List concerns and missing facts. Propose one concrete next step.",
              "Distinguish verified vs inferred. Cite only URLs grounded in the candidate brief.",
              "Do not invent facts or dump search snippets. No generic disclaimer walls.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              "Question:",
              question,
              "",
              "Candidate brief:",
              candidateBrief(candidate),
              "",
              "Allowed citation URLs:",
              sources.map((s) => `${s.label}: ${s.url}`).join("\n") || "none",
            ].join("\n"),
          },
        ],
        temperature: 0.2,
        maxOutputTokens: resolveAskMaxOutputTokens(),
        responseFormat: jsonSchemaResponseFormat({
          name: "hackathon_decision",
          schema: decisionJsonSchema(),
        }),
        metadata: { feature: "candidate-ask-decision" },
      },
      (raw) => parseDecisionRecommendation(raw, sources),
    );

    const decision = value;
    return {
      answer: formatDecisionAnswer(decision),
      confidence: decision.confidence,
      certainty:
        decision.confidence === "high"
          ? "inferred"
          : decision.missingInformation.length
            ? "unknown"
            : "inferred",
      sources: decision.citations.length ? decision.citations : sources,
      liveVerification: false,
      updatedFields: {},
      kind: "decision",
      decision,
      meta: buildAskObservabilityMeta({
        questionType: "decision",
        llmAttempted: true,
        llmSucceeded: true,
        fallbackUsed: false,
        model: response.model,
        latencyMs: Date.now() - started,
        researchCalls: 0,
      }),
    };
  } catch (error) {
    // Record fallback — do not silently discard.
    const message =
      error instanceof Error ? error.message.slice(0, 120) : "unknown error";
    console.warn("[candidate-ask-decision] LLM failed; using soft fallback", {
      message,
    });
    return {
      answer:
        "Could not complete an advisory recommendation right now. Try again, or ask a factual question about deadlines, eligibility, or mode.",
      confidence: "low",
      certainty: "unknown",
      sources,
      liveVerification: false,
      updatedFields: {},
      kind: "decision",
      meta: buildAskObservabilityMeta({
        questionType: "decision",
        llmAttempted: true,
        llmSucceeded: false,
        fallbackUsed: true,
        model: provider.name,
        latencyMs: Date.now() - started,
        researchCalls: 0,
      }),
    };
  }
}

export async function answerCandidateQuestion(
  candidate: CandidateDetail,
  question: string,
  options: AnswerCandidateQuestionOptions = {},
): Promise<CandidateQuestionAnswer> {
  const trimmed = question.trim();
  const kind = classifyCandidateQuestion(trimmed);
  const started = Date.now();

  if (kind === "decision") {
    return answerDecisionQuestion(candidate, trimmed, options.llmProvider);
  }

  const now = options.now ?? new Date();
  const local = answerLocally(candidate, trimmed, now);
  const maxSearch = options.maxSearchCalls ?? 1;
  let researchCalls = 0;
  let llmAttempted = false;
  let llmSucceeded = false;
  let fallbackUsed = false;

  const withMeta = (
    result: CandidateQuestionAnswer,
    extra?: Partial<AskObservabilityMeta>,
  ): CandidateQuestionAnswer => ({
    ...result,
    meta: buildAskObservabilityMeta({
      questionType: "factual",
      llmAttempted,
      llmSucceeded,
      fallbackUsed,
      latencyMs: Date.now() - started,
      researchCalls,
      ...extra,
    }),
  });

  if (
    !options.searchProvider ||
    maxSearch < 1 ||
    !needsResearch(trimmed, local)
  ) {
    return withMeta(local);
  }

  try {
    const researched = await researchOnce(
      candidate,
      trimmed,
      options.searchProvider,
    );
    researchCalls = 1;
    if (!researched) return withMeta({ ...local, liveVerification: false });

    const mergedSources = [
      ...local.sources,
      ...researched.sources.filter(
        (source) => !local.sources.some((existing) => existing.url === source.url),
      ),
    ].slice(0, 6);

    const llm =
      options.llmProvider === undefined
        ? createLlmProviderOptional({ instrument: false })
        : options.llmProvider;

    if (llm) {
      llmAttempted = true;
      const synthesized = await synthesizeFactualResearch({
        candidate,
        question: trimmed,
        local,
        researchNotes: researched.notes,
        researchSources: researched.sources,
        llmProvider: llm,
      });
      if (synthesized) {
        llmSucceeded = true;
        return withMeta(synthesized, { model: llm.name });
      }
      fallbackUsed = true;
    } else {
      fallbackUsed = true;
    }

    // Research informed sources only — never append SERP text to the answer.
    return withMeta({
      ...local,
      sources: mergedSources,
      liveVerification: true,
      factual: local.factual
        ? { ...local.factual, citations: mergedSources }
        : buildFactual(local.answer, local.certainty, mergedSources),
      confidence: local.confidence === "high" ? "medium" : local.confidence,
      certainty:
        local.certainty === "confirmed" ? "inferred" : local.certainty,
      kind: "factual",
    });
  } catch {
    fallbackUsed = true;
    return withMeta({ ...local, liveVerification: false });
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
