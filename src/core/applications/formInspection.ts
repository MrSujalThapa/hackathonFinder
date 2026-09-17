import * as cheerio from "cheerio";
import type { ApplicationQuestion } from "@/core/applications/types";

export function inspectApplicationForm(html: string): ApplicationQuestion[] {
  const $ = cheerio.load(html);
  const elements = $("input, textarea, select").toArray().filter((element) => {
    const type = ($(element).attr("type") ?? "").toLowerCase();
    return !["hidden", "submit", "button", "reset"].includes(type);
  });
  // Radio/checkbox inputs sharing a name act as one field (one answer fills the
  // whole group). Inspecting each option as its own required question makes
  // reconciliation unpassable: filling option B always contradicts option A.
  const grouped = new Map<string, number>();
  const questions: ApplicationQuestion[] = [];
  elements.forEach((element, index) => {
    const input = $(element);
    const type = (input.attr("type") ?? "").toLowerCase();
    const id = input.attr("id"); const name = input.attr("name");
    if ((type === "radio" || type === "checkbox") && name) {
      const key = `${type}:${name}`;
      const at = grouped.get(key);
      const value = input.attr("value") ?? "on";
      if (at !== undefined) {
        const existing = questions[at]!;
        if (!existing.options.includes(value)) existing.options.push(value);
        existing.required = existing.required || input.is("[required]") || input.attr("aria-required") === "true";
        return;
      }
      const label = input.closest("fieldset").find("legend").first().text() || input.attr("aria-label") || input.closest("label").text() || (id ? $(`label[for="${id}"]`).text() : "") || name;
      grouped.set(key, questions.length);
      questions.push({ id: name, label: label.trim(), fieldType: type, required: input.is("[required]") || input.attr("aria-required") === "true", options: [value], selector: `[name="${name}"]`, helpText: input.attr("aria-describedby") ? $(`#${input.attr("aria-describedby")}`).text().trim() : undefined, maxLength: input.attr("maxlength") ? Number(input.attr("maxlength")) : undefined, answer: null, answerSource: "unresolved", needsUserInput: false });
      return;
    }
    const label = (id ? $(`label[for="${id}"]`).text() : "") || input.closest("label").text() || input.attr("aria-label") || input.attr("placeholder") || name || `Field ${index + 1}`;
    const options = input.is("select") ? input.find("option").toArray().map((option) => $(option).text().trim()).filter(Boolean) : [];
    questions.push({ id: id || name || `field-${index + 1}`, label: label.trim(), fieldType: input.is("textarea") ? "textarea" : (input.attr("type") ?? element.tagName.toLowerCase()), required: input.is("[required]") || input.attr("aria-required") === "true", options, selector: id ? `#${id}` : `[name="${name ?? ""}"]`, helpText: input.attr("aria-describedby") ? $(`#${input.attr("aria-describedby")}`).text().trim() : undefined, maxLength: input.attr("maxlength") ? Number(input.attr("maxlength")) : undefined, answer: input.val()?.toString() || null, answerSource: "unresolved", needsUserInput: false });
  });
  return questions;
}
