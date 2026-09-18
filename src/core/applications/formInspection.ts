import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { ApplicationQuestion } from "@/core/applications/types";

/**
 * Resolves the standard `aria-labelledby="id1 id2"` accessible-name pattern —
 * many real forms (e.g. Google Forms) associate a question's visible heading
 * text with its input this way instead of `<label for>` or `aria-label`.
 */
function ariaLabelledByText($: cheerio.CheerioAPI, element: Element): string {
  const ids = ($(element).attr("aria-labelledby") ?? "").trim();
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => $(`#${CSS_ESCAPE(id)}`).first().text().trim())
    .filter(Boolean)
    .join(" ");
}

// cheerio has no DOM CSS.escape; ids from real pages are safe HTML id tokens,
// but escape defensively for ids containing characters unsafe in a selector.
function CSS_ESCAPE(id: string): string {
  return id.replace(/([ #.;?%&,+*~':"!^$[\]()=>|/])/g, "\\$1");
}

export function inspectApplicationForm(html: string): ApplicationQuestion[] {
  const $ = cheerio.load(html);
  // Positions computed over the SAME unfiltered "input, textarea, select" set
  // Playwright will query live, so a `:nth-match` fallback selector lines up
  // with the live DOM even though hidden/submit/button elements are excluded
  // from the questions below.
  const allInputLikeElements = $("input, textarea, select").toArray();
  const globalPosition = new Map<Element, number>();
  allInputLikeElements.forEach((element, index) => globalPosition.set(element, index + 1));

  const elements = allInputLikeElements.filter((element) => {
    const type = ($(element).attr("type") ?? "").toLowerCase();
    return !["hidden", "submit", "button", "reset"].includes(type);
  });

  // Real-world forms (Google Forms, many custom SPAs) frequently render
  // inputs with neither `id` nor `name` — a selector must never silently
  // fall back to an empty/non-unique attribute selector like `[name=""]`,
  // which would match every such field on the page.
  function selectorFor(element: Element, id: string | undefined, name: string | undefined): string {
    if (id) return `#${CSS_ESCAPE(id)}`;
    if (name) return `[name="${name}"]`;
    const position = globalPosition.get(element);
    return `:nth-match(input, textarea, select, ${position})`;
  }

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
      const label = ariaLabelledByText($, element) || input.closest("fieldset").find("legend").first().text() || input.attr("aria-label") || input.closest("label").text() || (id ? $(`label[for="${id}"]`).text() : "") || name;
      grouped.set(key, questions.length);
      questions.push({ id: name, label: label.trim(), fieldType: type, required: input.is("[required]") || input.attr("aria-required") === "true", options: [value], selector: `[name="${name}"]`, helpText: input.attr("aria-describedby") ? $(`#${input.attr("aria-describedby")}`).text().trim() : undefined, maxLength: input.attr("maxlength") ? Number(input.attr("maxlength")) : undefined, answer: null, answerSource: "unresolved", needsUserInput: false });
      return;
    }
    const label = ariaLabelledByText($, element) || (id ? $(`label[for="${id}"]`).text() : "") || input.closest("label").text() || input.attr("aria-label") || input.attr("placeholder") || name || `Field ${index + 1}`;
    const options = input.is("select") ? input.find("option").toArray().map((option) => $(option).text().trim()).filter(Boolean) : [];
    questions.push({ id: id || name || `field-${index + 1}`, label: label.trim(), fieldType: input.is("textarea") ? "textarea" : (input.attr("type") ?? element.tagName.toLowerCase()), required: input.is("[required]") || input.attr("aria-required") === "true", options, selector: selectorFor(element, id, name), helpText: input.attr("aria-describedby") ? $(`#${input.attr("aria-describedby")}`).text().trim() : undefined, maxLength: input.attr("maxlength") ? Number(input.attr("maxlength")) : undefined, answer: input.val()?.toString() || null, answerSource: "unresolved", needsUserInput: false });
  });
  return questions;
}
