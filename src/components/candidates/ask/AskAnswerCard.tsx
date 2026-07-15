import type { CandidateDetail } from "@/core/candidates/types";
import {
  readPersistedAskPayload,
  reasonText,
  type DecisionRecommendation,
  type FactualAnswerPayload,
} from "@/core/candidateAskDecision";
import { AskCitations } from "./AskCitations";
import {
  certaintyLabel,
  confidenceLabel,
  evidenceStatusLabel,
  recommendationLabel,
  recommendationStampStyle,
} from "./askLabels";
import { factualAnswerBlocks } from "./stripLiveSearchAddendum";

function AskMetaRow({
  confidence,
  liveVerification,
  showStoredEvidence,
}: {
  confidence: string | null | undefined;
  liveVerification: boolean;
  showStoredEvidence?: boolean;
}) {
  const confidenceText = confidenceLabel(confidence);
  const evidenceText = evidenceStatusLabel(liveVerification, {
    showStored: showStoredEvidence && !liveVerification,
  });
  if (!confidenceText && !evidenceText) return null;

  return (
    <p className="text-[11px] leading-snug text-muted">
      {[confidenceText, evidenceText].filter(Boolean).join(" · ")}
    </p>
  );
}

function DecisionAnswerLayout({
  question,
  decision,
  links,
  liveVerification,
  answerId,
}: {
  question: string;
  decision: DecisionRecommendation;
  links: { url: string; label: string }[];
  liveVerification: boolean;
  answerId: string;
}) {
  const sources = decision.citations.length > 0 ? decision.citations : links;
  const reasonLines = decision.reasons.map(reasonText).filter(Boolean);
  const showSummary =
    Boolean(decision.summary) && decision.summary !== decision.headline;

  return (
    <li className="border-t border-border-subtle pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{question}</p>
        <AskMetaRow
          confidence={decision.confidence}
          liveVerification={liveVerification}
        />
      </div>

      <div className="mt-2 space-y-2.5 text-sm text-foreground/85">
        <div className="space-y-1.5">
          <span
            className="inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
            style={recommendationStampStyle(decision.recommendation)}
          >
            {recommendationLabel(decision.recommendation)}
          </span>
          <p className="text-base font-medium leading-snug text-foreground">
            {decision.headline}
          </p>
          {showSummary ? (
            <p className="text-sm leading-relaxed text-foreground/80">
              {decision.summary}
            </p>
          ) : null}
        </div>

        {reasonLines.length > 0 ? (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted">
              Why
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {reasonLines.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {decision.concerns.length > 0 ? (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted">
              Concerns
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {decision.concerns.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {decision.missingInformation.length > 0 ? (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted">
              Missing
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {decision.missingInformation.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {decision.nextStep ? (
          <p>
            <span className="text-[11px] uppercase tracking-wider text-muted">
              Next step{" "}
            </span>
            {decision.nextStep}
          </p>
        ) : null}
      </div>

      <AskCitations links={sources} answerId={answerId} />
    </li>
  );
}

function FactualAnswerLayout({
  question,
  answerText,
  confidence,
  certainty,
  links,
  liveVerification,
  answerId,
  supportingFacts,
}: {
  question: string;
  answerText: string;
  confidence: string | null | undefined;
  certainty: string | null;
  links: { url: string; label: string }[];
  liveVerification: boolean;
  answerId: string;
  supportingFacts?: string[];
}) {
  const blocks = factualAnswerBlocks(answerText);
  const certaintyText = certaintyLabel(certainty);
  const facts = (supportingFacts ?? []).filter(Boolean).slice(0, 3);

  return (
    <li className="border-t border-border-subtle pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{question}</p>
        <AskMetaRow
          confidence={confidence}
          liveVerification={liveVerification}
          showStoredEvidence={!liveVerification}
        />
      </div>

      {blocks.length > 0 ? (
        <div className="mt-1.5 space-y-2 text-sm leading-relaxed text-foreground/85">
          {blocks.map((block) => (
            <p key={block.slice(0, 48)}>{block}</p>
          ))}
        </div>
      ) : null}

      {facts.length > 0 ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-sm text-foreground/75">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      ) : null}

      {certaintyText ? (
        <p className="mt-1.5 text-[11px] text-muted">{certaintyText}</p>
      ) : null}

      <AskCitations links={links} answerId={answerId} />
    </li>
  );
}

function resolveFactualDisplay(
  answer: CandidateDetail["answers"][number],
  factual: FactualAnswerPayload | null,
  links: { url: string; label: string }[],
  certainty: string | null,
): {
  answerText: string;
  certainty: string | null;
  links: { url: string; label: string }[];
  supportingFacts: string[];
} {
  if (factual) {
    return {
      answerText: factual.answer,
      certainty: factual.certainty,
      links: factual.citations.length > 0 ? factual.citations : links,
      supportingFacts: factual.supportingFacts,
    };
  }
  return {
    answerText: answer.answer,
    certainty,
    links,
    supportingFacts: [],
  };
}

export function AskAnswerCard({
  answer,
}: {
  answer: CandidateDetail["answers"][number];
}) {
  const payload = readPersistedAskPayload(answer.sources);
  const decision = payload.decision;

  if (decision) {
    return (
      <DecisionAnswerLayout
        question={answer.question}
        decision={decision}
        links={payload.links}
        liveVerification={payload.liveVerification}
        answerId={answer.id}
      />
    );
  }

  const factual = resolveFactualDisplay(
    answer,
    payload.factual,
    payload.links,
    payload.certainty,
  );

  return (
    <FactualAnswerLayout
      question={answer.question}
      answerText={factual.answerText}
      confidence={answer.confidence}
      certainty={factual.certainty}
      links={factual.links}
      liveVerification={payload.liveVerification}
      answerId={answer.id}
      supportingFacts={factual.supportingFacts}
    />
  );
}
