"use client";

import type { CandidateDetail } from "@/core/candidates/types";
import { AskAnswerCard } from "./AskAnswerCard";

type AskComposerProps = {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (value: string) => void;
  loading: boolean;
  error: string | null;
  answers: CandidateDetail["answers"];
};

/** Simplified Ask thread: quiet field, Enter submit, answers newest-first. */
export function AskComposer({
  question,
  onQuestionChange,
  onSubmit,
  loading,
  error,
  answers,
}: AskComposerProps) {
  return (
    <section className="space-y-3 border-t border-border-subtle pt-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(question);
        }}
      >
        <textarea
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit(question);
            }
          }}
          disabled={loading}
          rows={3}
          placeholder="Ask about this event…"
          className="hf-input min-h-[4.5rem] w-full resize-y"
          aria-label="Ask a question about this candidate"
        />
        {loading ? (
          <p className="mt-2 text-xs text-muted" role="status">
            Thinking…
          </p>
        ) : null}
      </form>
      {error ? (
        <p className="text-xs text-amber-100/90" role="alert">
          {error}
        </p>
      ) : null}
      {answers.length > 0 ? (
        <ul className="space-y-0">
          {answers.map((answer) => (
            <AskAnswerCard key={answer.id} answer={answer} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
