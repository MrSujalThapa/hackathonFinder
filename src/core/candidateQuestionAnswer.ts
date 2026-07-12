import type { CandidateDetail, CandidateEvidence } from "@/core/candidates/types";

export type CandidateAnswerSource = {
  url: string;
  label: string;
};

export type CandidateQuestionAnswer = {
  answer: string;
  confidence: "low" | "medium" | "high";
  sources: CandidateAnswerSource[];
  updatedFields: Partial<CandidateDetail>;
};

function evidenceSources(candidate: CandidateDetail): CandidateAnswerSource[] {
  const sources = candidate.evidence
    .map((item) => ({
      url: item.url,
      label: item.title ?? item.type.replace(/_/g, " "),
    }))
    .filter((item): item is CandidateAnswerSource => Boolean(item.url));
  return sources.slice(0, 4);
}

function firstSource(candidate: CandidateDetail): CandidateAnswerSource[] {
  if (candidate.officialUrl) return [{ url: candidate.officialUrl, label: "Official event page" }];
  if (candidate.applyUrl) return [{ url: candidate.applyUrl, label: "Application page" }];
  return evidenceSources(candidate);
}

function mentionFromEvidence(
  evidence: CandidateEvidence[],
  patterns: RegExp[],
): string | null {
  const text = evidence
    .map((item) => [item.title, item.snippet].filter(Boolean).join(" "))
    .join(" ");
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim();
  }
  return null;
}

export function answerCandidateQuestion(
  candidate: CandidateDetail,
  question: string,
): CandidateQuestionAnswer {
  const lower = question.toLowerCase();
  const sources = firstSource(candidate);

  if (/deadline|registration.*(close|due)|apply.*by/.test(lower)) {
    if (candidate.deadline) {
      return {
        answer: `The application deadline is ${candidate.deadline}.`,
        confidence: "high",
        sources,
        updatedFields: {},
      };
    }
    const hint = mentionFromEvidence(candidate.evidence, [/deadline[:\s]+[^.]{4,80}/i]);
    return {
      answer: hint
        ? `I found a deadline hint in the evidence, but it needs review: ${hint}.`
        : "I could not verify an application deadline from the stored evidence.",
      confidence: hint ? "medium" : "low",
      sources,
      updatedFields: {},
    };
  }

  if (/remote|online|virtual/.test(lower)) {
    const isRemote =
      candidate.mode === "online" ||
      /remote|online|virtual/i.test([candidate.location, candidate.city, candidate.country].filter(Boolean).join(" "));
    return {
      answer: isRemote
        ? "Yes, this appears to be remote or online."
        : candidate.mode === "in-person"
          ? "No, this appears to be in-person."
          : "The stored evidence does not make the event mode fully clear.",
      confidence: candidate.mode && candidate.mode !== "unknown" ? "high" : "low",
      sources,
      updatedFields: {},
    };
  }

  if (/where|location|venue|city/.test(lower)) {
    const place = [candidate.city, candidate.country].filter(Boolean).join(", ") || candidate.location;
    return {
      answer: place ? `The listed location is ${place}.` : "I could not verify the location from stored evidence.",
      confidence: place ? "high" : "low",
      sources,
      updatedFields: {},
    };
  }

  if (/eligible|eligibility|student|who can/.test(lower)) {
    return {
      answer: candidate.eligibility
        ? `Eligibility: ${candidate.eligibility}.`
        : "Eligibility is not clearly verified in the stored candidate data.",
      confidence: candidate.eligibility ? "high" : "low",
      sources,
      updatedFields: {},
    };
  }

  if (/prize|sponsor|award/.test(lower)) {
    return {
      answer: candidate.prize
        ? `Prize/sponsor note: ${candidate.prize}.`
        : "I could not verify prizes or sponsors from stored candidate data.",
      confidence: candidate.prize ? "high" : "low",
      sources,
      updatedFields: {},
    };
  }

  if (/team size|team/.test(lower)) {
    const hint = mentionFromEvidence(candidate.evidence, [/team size[:\s]+[^.]{2,80}/i, /teams? of [^.]{2,40}/i]);
    return {
      answer: hint ?? "I could not verify team size from the stored evidence.",
      confidence: hint ? "medium" : "low",
      sources,
      updatedFields: {},
    };
  }

  if (/open|registration still|still open/.test(lower)) {
    if (!candidate.deadline) {
      return {
        answer: "Registration status is uncertain because no verified deadline is stored.",
        confidence: "low",
        sources,
        updatedFields: {},
      };
    }
    const today = new Date().toISOString().slice(0, 10);
    const open = candidate.deadline >= today;
    return {
      answer: open
        ? `Registration appears open based on the stored deadline (${candidate.deadline}).`
        : `Registration appears closed based on the stored deadline (${candidate.deadline}).`,
      confidence: "medium",
      sources,
      updatedFields: {},
    };
  }

  if (/official.*(application|apply)|application page|apply link/.test(lower)) {
    const url = candidate.applyUrl ?? candidate.officialUrl;
    return {
      answer: url ? `The best application link I have is ${url}.` : "I do not have a verified application link yet.",
      confidence: candidate.applyUrl ? "high" : candidate.officialUrl ? "medium" : "low",
      sources: url ? [{ url, label: candidate.applyUrl ? "Application page" : "Official event page" }] : sources,
      updatedFields: {},
    };
  }

  if (/why.*match|preferences|fit/.test(lower)) {
    const why = candidate.whyMatch.length > 0 ? candidate.whyMatch.join("; ") : "No specific match reasons are stored.";
    return {
      answer: why,
      confidence: candidate.whyMatch.length > 0 ? "high" : "low",
      sources,
      updatedFields: {},
    };
  }

  return {
    answer: "I could not answer that confidently from the stored candidate evidence yet.",
    confidence: "low",
    sources,
    updatedFields: {},
  };
}
