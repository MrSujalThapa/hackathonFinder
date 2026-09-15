import * as cheerio from "cheerio";
import type { ApplicationQuestion } from "@/core/applications/types";

export function inspectApplicationForm(html: string): ApplicationQuestion[] {
  const $ = cheerio.load(html);
  return $("input, textarea, select").toArray().filter((element) => {
    const type = ($(element).attr("type") ?? "").toLowerCase();
    return !["hidden", "submit", "button", "reset"].includes(type);
  }).map((element, index) => {
    const input = $(element); const id = input.attr("id"); const name = input.attr("name");
    const label = (id ? $(`label[for="${id}"]`).text() : "") || input.closest("label").text() || input.attr("aria-label") || input.attr("placeholder") || name || `Field ${index + 1}`;
    const options = input.is("select") ? input.find("option").toArray().map((option) => $(option).text().trim()).filter(Boolean) : [];
    return { id: id || name || `field-${index + 1}`, label: label.trim(), fieldType: input.is("textarea") ? "textarea" : (input.attr("type") ?? input[0].tagName.toLowerCase()), required: input.is("[required]") || input.attr("aria-required") === "true", options, selector: id ? `#${id}` : `[name="${name ?? ""}"]`, helpText: input.attr("aria-describedby") ? $(`#${input.attr("aria-describedby")}`).text().trim() : undefined, maxLength: input.attr("maxlength") ? Number(input.attr("maxlength")) : undefined, answer: input.val()?.toString() || null, answerSource: "unresolved", needsUserInput: false };
  });
}
