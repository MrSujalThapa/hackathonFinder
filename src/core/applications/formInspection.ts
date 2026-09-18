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

/**
 * Custom ARIA choice widgets: real forms (Google Forms and many other
 * hand-built SPAs) increasingly render radio/checkbox questions as styled
 * `role="radio"`/`role="checkbox"` elements with `aria-checked`, not native
 * `<input>`. `:not(input)` excludes any element that redundantly sets the
 * role on an actual native input, which the existing native-input pass
 * already handles.
 */
export const ARIA_CHOICE_SELECTOR = '[role="radio"]:not(input), [role="checkbox"]:not(input)';

/**
 * Accessible value for one ARIA choice option: its own accessible name, not
 * the question's. Normalizes the empty/sentinel value some platforms use for
 * a free-text "Other" option into a human label.
 */
export function ariaChoiceOptionValue(rawValue: string): string {
  return !rawValue || rawValue === "__other_option__" ? "Other" : rawValue;
}

/**
 * Base query for the positional `:nth-match` fallback — deliberately
 * excludes hidden/submit/button/reset, matching the "elements" the
 * extraction below turns into questions. Hidden fields are excluded from the
 * count entirely (not merely from becoming their own question): verified on
 * a real form (Google Forms) that interacting with ANY field can lazily
 * insert a brand-new hidden mirror `<input>` ahead of the visible fields,
 * which would silently renumber every later visible field if hidden inputs
 * were part of the counted set. Visible fields don't get inserted/removed
 * this way, so counting only them keeps positions stable across
 * interactions.
 */
export const VISIBLE_INPUT_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select';

export function inspectApplicationForm(html: string): ApplicationQuestion[] {
  const $ = cheerio.load(html);
  const elements = $(VISIBLE_INPUT_SELECTOR).toArray();
  const globalPosition = new Map<Element, number>();
  elements.forEach((element, index) => globalPosition.set(element, index + 1));

  // Real-world forms (Google Forms, many custom SPAs) frequently render
  // inputs with neither `id` nor `name` — a selector must never silently
  // fall back to an empty/non-unique attribute selector like `[name=""]`,
  // which would match every such field on the page.
  function selectorFor(element: Element, id: string | undefined, name: string | undefined): string {
    if (id) return `#${CSS_ESCAPE(id)}`;
    if (name) return `[name="${name}"]`;
    const position = globalPosition.get(element);
    return `:nth-match(${VISIBLE_INPUT_SELECTOR}, ${position})`;
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

  // ARIA custom choice widgets. Grouping by nesting depth/ancestor role is
  // NOT reliable here: verified empirically that the same real form nests a
  // checkbox-group question's options two role="listitem" levels below the
  // heading while its radio-group questions nest only one level below, with
  // no shared explicit "radiogroup"/"group" container either. What IS
  // reliable and general: reading order — every option belongs to the
  // nearest preceding role="heading", regardless of DOM nesting shape. Plain
  // <label>/<legend>/<fieldset> ARIA questions with a real radiogroup/group
  // role also work as expected since a role="heading" question label is the
  // dominant real-world pattern for hand-built and generated (Google Forms,
  // similar SPA) choice questions alike.
  const ariaMarkers = $(`[role="heading"], ${ARIA_CHOICE_SELECTOR}`).toArray();
  const ariaChoiceElements = $(ARIA_CHOICE_SELECTOR).toArray();
  const ariaPosition = new Map<Element, number>();
  ariaChoiceElements.forEach((element, index) => ariaPosition.set(element, index + 1));

  type AriaGroup = {
    heading: string;
    fieldType: "radio" | "checkbox";
    required: boolean;
    options: Array<{ value: string; position: number }>;
  };
  const ariaGroups: AriaGroup[] = [];
  let currentHeadingText = "";
  let currentHeadingRequired = false;
  for (const marker of ariaMarkers) {
    const $marker = $(marker);
    if ($marker.attr("role") === "heading") {
      currentHeadingText = $marker.text().trim();
      currentHeadingRequired = $marker.attr("aria-required") === "true" || /\*\s*$/.test(currentHeadingText);
      continue;
    }
    const role = $marker.attr("role") === "radio" ? "radio" : "checkbox";
    const position = ariaPosition.get(marker);
    if (position === undefined) continue;
    const rawValue = $marker.attr("data-answer-value") ?? $marker.attr("aria-label") ?? $marker.text().trim();
    const value = ariaChoiceOptionValue(rawValue);
    let group = ariaGroups.find((candidate) => candidate.heading === currentHeadingText && candidate.fieldType === role);
    if (!group) {
      group = {
        heading: currentHeadingText || `Choice group ${ariaGroups.length + 1}`,
        fieldType: role,
        required: currentHeadingRequired,
        options: [],
      };
      ariaGroups.push(group);
    }
    group.options.push({ value, position });
  }

  ariaGroups.forEach((group, groupIndex) => {
    if (group.options.length === 0) return;
    questions.push({
      id: `aria-choice-${groupIndex}`,
      label: group.heading,
      fieldType: group.fieldType,
      required: group.required,
      options: group.options.map((option) => option.value),
      selector: group.options
        .map((option) => `:nth-match(${ARIA_CHOICE_SELECTOR}, ${option.position})`)
        .join(", "),
      answer: null,
      answerSource: "unresolved",
      needsUserInput: false,
    });
  });

  return questions;
}
