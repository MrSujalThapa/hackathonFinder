export type OpportunityType =
  | "hackathon" | "tech_event" | "conference" | "fellowship"
  | "pitch_competition" | "accelerator" | "startup_program" | "competition" | "other";

export type ApplicationStatus =
  | "not_started" | "scheduled" | "drafting" | "needs_input"
  | "ready_for_review" | "approved" | "submitting" | "submitted" | "failed";

export type AnswerSource = "profile" | "question_bank" | "ai" | "user" | "unresolved";

export type ApplicationQuestion = {
  id: string;
  label: string;
  fieldType: string;
  required: boolean;
  options: string[];
  selector: string;
  helpText?: string;
  maxLength?: number;
  answer: string | null;
  answerSource: AnswerSource;
  needsUserInput: boolean;
};

export type ApplicationDraft = {
  id: string;
  opportunityId: string;
  applicationUrl: string;
  status: ApplicationStatus;
  draftVersion: number;
  approvedDraftVersion: number | null;
  approvedAt: string | null;
  questions: ApplicationQuestion[];
};

export type Profile = Record<string, string>;
export type QuestionBankEntry = { id: string; canonicalQuestion: string; answer: string; aliases: string[]; tags: string[]; updatedAt: string };
export type NotificationType = "APPLICATION_OPEN" | "APPLICATION_NEEDS_INPUT" | "APPLICATION_READY_FOR_REVIEW" | "DEADLINE_SOON" | "SUBMISSION_FAILED";
