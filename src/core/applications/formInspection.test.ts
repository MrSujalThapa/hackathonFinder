import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectApplicationForm } from "@/core/applications/formInspection";

describe("inspectApplicationForm", () => {
  it("resolves aria-labelledby into the question label (Google Forms pattern)", () => {
    const html = `
      <form>
        <div role="listitem">
          <div role="heading" id="q1">What is your team name?</div>
          <div id="q1-desc">Answer required</div>
          <textarea aria-labelledby="q1 q1-desc"></textarea>
        </div>
      </form>
    `;
    const questions = inspectApplicationForm(html);
    assert.equal(questions.length, 1);
    assert.equal(questions[0]!.label, "What is your team name? Answer required");
    assert.equal(questions[0]!.fieldType, "textarea");
  });

  it("prefers aria-labelledby over a fallback field-index label", () => {
    const html = `<input id="i17" aria-labelledby="h17" /><span id="h17">Email address</span>`;
    const questions = inspectApplicationForm(html);
    assert.equal(questions[0]!.label, "Email address");
  });

  it("still falls back through label/aria-label/placeholder when aria-labelledby is absent", () => {
    const html = `
      <label for="name">Full name</label>
      <input id="name" />
      <input aria-label="Phone number" />
      <input placeholder="City" />
    `;
    const questions = inspectApplicationForm(html);
    assert.deepEqual(
      questions.map((q) => q.label),
      ["Full name", "Phone number", "City"],
    );
  });

  it("keeps grouping radio/checkbox inputs by name into a single question with aria-labelledby resolved", () => {
    const html = `
      <div id="g1">Preferred track</div>
      <input type="radio" name="track" value="AI" aria-labelledby="g1" />
      <input type="radio" name="track" value="Web" aria-labelledby="g1" />
    `;
    const questions = inspectApplicationForm(html);
    assert.equal(questions.length, 1);
    assert.equal(questions[0]!.label, "Preferred track");
    assert.deepEqual(questions[0]!.options, ["AI", "Web"]);
  });

  it("falls back to a unique positional selector instead of a shared empty [name=\"\"] when id/name are both absent", () => {
    const html = `
      <input type="text" />
      <textarea></textarea>
      <input type="text" />
    `;
    const questions = inspectApplicationForm(html);
    const selectors = questions.map((q) => q.selector);
    assert.equal(new Set(selectors).size, selectors.length, "every selector must be unique");
    for (const selector of selectors) assert.doesNotMatch(selector, /\[name=""\]/);
    assert.deepEqual(selectors, [
      ":nth-match(input, textarea, select, 1)",
      ":nth-match(input, textarea, select, 2)",
      ":nth-match(input, textarea, select, 3)",
    ]);
  });

  it("keeps positional selector numbering aligned with the live DOM query (hidden fields still counted)", () => {
    const html = `
      <input type="hidden" name="csrf" />
      <input type="text" />
      <input type="submit" value="Send" />
      <textarea></textarea>
    `;
    const questions = inspectApplicationForm(html);
    // Position 1 is the hidden csrf field (excluded from questions, but still
    // present in the live "input, textarea, select" query Playwright runs),
    // so the visible text input must be position 2, not 1.
    assert.equal(questions[0]!.selector, ":nth-match(input, textarea, select, 2)");
    assert.equal(questions[1]!.selector, ":nth-match(input, textarea, select, 4)");
  });

  it("excludes hidden/submit/button inputs from extracted questions", () => {
    const html = `
      <input type="hidden" name="csrf" value="x" />
      <input type="submit" value="Send" />
      <input type="text" name="name" />
    `;
    const questions = inspectApplicationForm(html);
    assert.equal(questions.length, 1);
    assert.equal(questions[0]!.fieldType, "text");
  });
});
