export type FormActionSafety = "SAFE_NAVIGATION" | "POSSIBLE_SUBMIT" | "CONFIRMED_SUBMIT";
export type ActionEvidence = { tagName?: string; type?: string; formAction?: string; currentPage?: number; totalPages?: number; text?: string };

/** Conservative classification: labels are only supporting evidence, never sufficient to click. */
export function classifyFormAction(action: ActionEvidence): FormActionSafety {
  const type = (action.type ?? "").toLowerCase(); const text = (action.text ?? "").toLowerCase(); const formAction = (action.formAction ?? "").toLowerCase();
  if (type === "submit" || /submit|complete|finish|register|send/.test(text) || /submit|complete|finish/.test(formAction)) return "CONFIRMED_SUBMIT";
  if (action.currentPage && action.totalPages && action.currentPage < action.totalPages && /next|continue/.test(text) && type === "button") return "SAFE_NAVIGATION";
  return "POSSIBLE_SUBMIT";
}
