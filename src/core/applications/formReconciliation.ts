import path from "node:path";
import type { ApplicationQuestion } from "@/core/applications/types";

export type ExternalFormControl = { selector: string; label: string; name: string; id: string; fieldType: string; required: boolean; options: string[]; value: string | null; checked?: boolean; files?: string[] };
export type ReconciliationMismatch = { questionId: string; label: string; reason: "missing_control" | "wrong_mapping" | "required_mismatch" | "wrong_value" | "wrong_option" | "wrong_file"; expected: string | null; actual: string | null; selector: string };
export type ReconciliationResult = { ok: boolean; mismatches: ReconciliationMismatch[] };

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const fileName = (value: string) => path.basename(value.replace(/\\/g, "/"));

/**
 * A grouped checkbox question (native or ARIA `role="checkbox"`) can have
 * more than one selected option. The answer is a delimited list of the
 * selected options' own values, order-independent — both fill and
 * reconciliation treat it as a set, not a literal string.
 */
export const MULTI_VALUE_DELIMITER = ", ";
export function splitMultiValue(answer: string): string[] {
  return answer.split(",").map((value) => value.trim()).filter(Boolean);
}
function isGroupedCheckbox(question: ApplicationQuestion): boolean {
  return question.fieldType === "checkbox" && question.options.length > 1;
}
function sameValueSet(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((value) => setB.has(value));
}

/** Compares persisted answers against the live DOM without using an LLM. */
export function reconcileExternalForm(questions: ApplicationQuestion[], controls: ExternalFormControl[]): ReconciliationResult {
  const mismatches: ReconciliationMismatch[] = [];
  for (const question of questions.filter((item) => item.answer && item.required)) {
    const control = controls.find((item) => item.selector === question.selector) ?? controls.find((item) => normalized(item.label) === normalized(question.label));
    if (!control) { mismatches.push({ questionId: question.id, label: question.label, reason: "missing_control", expected: question.answer, actual: null, selector: question.selector }); continue; }
    if (normalized(control.label) !== normalized(question.label) && normalized(control.name) !== normalized(question.label) && normalized(control.id) !== normalized(question.label)) { mismatches.push({ questionId: question.id, label: question.label, reason: "wrong_mapping", expected: question.answer, actual: control.value, selector: control.selector }); continue; }
    if (control.required !== question.required) { mismatches.push({ questionId: question.id, label: question.label, reason: "required_mismatch", expected: question.answer, actual: control.value, selector: control.selector }); continue; }
    if (question.fieldType === "file") {
      if (!(control.files ?? []).some((file) => fileName(file) === fileName(question.answer!))) mismatches.push({ questionId: question.id, label: question.label, reason: "wrong_file", expected: question.answer, actual: control.files?.join(", ") ?? null, selector: control.selector });
      continue;
    }
    const grouped = isGroupedCheckbox(question);
    const requestedValues = grouped ? splitMultiValue(question.answer!) : [question.answer!];
    if (["select", "radio", "checkbox"].includes(question.fieldType) && control.options.length && requestedValues.some((value) => !control.options.includes(value))) { mismatches.push({ questionId: question.id, label: question.label, reason: "wrong_option", expected: question.answer, actual: control.value, selector: control.selector }); continue; }
    const valueMatches = grouped ? sameValueSet(requestedValues, splitMultiValue(control.value ?? "")) : control.value === question.answer;
    if (!valueMatches) mismatches.push({ questionId: question.id, label: question.label, reason: "wrong_value", expected: question.answer, actual: control.value, selector: control.selector });
  }
  return { ok: mismatches.length === 0, mismatches };
}
