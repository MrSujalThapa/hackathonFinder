import assert from "node:assert/strict";
import test from "node:test";
import { reconcileExternalForm, type ExternalFormControl } from "@/core/applications/formReconciliation";
import type { ApplicationQuestion } from "@/core/applications/types";

const question = (overrides: Partial<ApplicationQuestion> = {}): ApplicationQuestion => ({ id: "movie", label: "Favorite movie", fieldType: "text", required: true, options: [], selector: "#movie", answer: "Interstellar", answerSource: "user", needsUserInput: false, ...overrides });
const control = (overrides: Partial<ExternalFormControl> = {}): ExternalFormControl => ({ selector: "#movie", label: "Favorite movie", name: "movie", id: "movie", fieldType: "text", required: true, options: [], value: "Interstellar", ...overrides });

test("reconciles matching controls deterministically", () => assert.equal(reconcileExternalForm([question()], [control()]).ok, true));
test("blocks a wrong field mapping even when its value happens to match", () => {
  const result = reconcileExternalForm([question({ selector: "#sport" })], [control({ selector: "#sport", label: "Favorite sport", name: "sport", id: "sport" })]);
  assert.equal(result.mismatches[0]?.reason, "wrong_mapping");
});
test("blocks dropdown and file mismatches", () => {
  const dropdown = reconcileExternalForm([question({ id: "school", label: "School", fieldType: "select", selector: "#school", answer: "Waterloo" })], [control({ selector: "#school", label: "School", name: "school", id: "school", fieldType: "select", options: ["Toronto"], value: "Toronto" })]);
  const file = reconcileExternalForm([question({ id: "resume", label: "Resume", fieldType: "file", selector: "#resume", answer: "assets/resume.pdf" })], [control({ selector: "#resume", label: "Resume", name: "resume", id: "resume", fieldType: "file", files: ["other.pdf"], value: null })]);
  assert.equal(dropdown.mismatches[0]?.reason, "wrong_option"); assert.equal(file.mismatches[0]?.reason, "wrong_file");
});

test("reconciles a grouped multi-select checkbox as a set, independent of order", () => {
  const skills = question({ id: "skills", label: "Skills", fieldType: "checkbox", selector: ":nth-match(x, 1), :nth-match(x, 2), :nth-match(x, 3)", options: ["Writing code", "Design", "Docs"], answer: "Writing code, Design" });
  const matchingDifferentOrder = control({ selector: skills.selector, label: "Skills", name: "", id: "", fieldType: "checkbox", options: ["Writing code", "Design", "Docs"], value: "Design, Writing code" });
  assert.equal(reconcileExternalForm([skills], [matchingDifferentOrder]).ok, true);
});

test("flags a grouped multi-select checkbox missing a requested selection", () => {
  const skills = question({ id: "skills", label: "Skills", fieldType: "checkbox", selector: ":nth-match(x, 1), :nth-match(x, 2)", options: ["Writing code", "Design"], answer: "Writing code, Design" });
  const onlyOneSelected = control({ selector: skills.selector, label: "Skills", name: "", id: "", fieldType: "checkbox", options: ["Writing code", "Design"], value: "Writing code" });
  const result = reconcileExternalForm([skills], [onlyOneSelected]);
  assert.equal(result.ok, false);
  assert.equal(result.mismatches[0]?.reason, "wrong_value");
});

test("flags a grouped multi-select checkbox requesting an option the live form does not offer", () => {
  const skills = question({ id: "skills", label: "Skills", fieldType: "checkbox", selector: ":nth-match(x, 1)", options: ["Writing code"], answer: "Writing code, Unknown option" });
  const control2 = control({ selector: skills.selector, label: "Skills", name: "", id: "", fieldType: "checkbox", options: ["Writing code"], value: "Writing code" });
  const result = reconcileExternalForm([skills], [control2]);
  assert.equal(result.ok, false);
  assert.equal(result.mismatches[0]?.reason, "wrong_option");
});
