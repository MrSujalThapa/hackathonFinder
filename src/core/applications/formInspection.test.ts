import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARIA_CHOICE_SELECTOR, VISIBLE_INPUT_SELECTOR, inspectApplicationForm } from "@/core/applications/formInspection";

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
      `:nth-match(${VISIBLE_INPUT_SELECTOR}, 1)`,
      `:nth-match(${VISIBLE_INPUT_SELECTOR}, 2)`,
      `:nth-match(${VISIBLE_INPUT_SELECTOR}, 3)`,
    ]);
  });

  it("excludes hidden/submit/button fields from the positional count, since a real form can lazily insert new hidden fields after interaction", () => {
    const html = `
      <input type="hidden" name="csrf" />
      <input type="text" />
      <input type="submit" value="Send" />
      <textarea></textarea>
    `;
    const questions = inspectApplicationForm(html);
    // If hidden fields were counted, the visible text input would be
    // position 2 — but a real form (verified on Google Forms) can insert a
    // brand-new hidden mirror <input> ahead of the visible fields the first
    // time ANY field is interacted with, which would silently renumber every
    // later visible field. Counting only the same visible set used to build
    // selectors keeps positions stable across such interactions.
    assert.equal(questions[0]!.selector, `:nth-match(${VISIBLE_INPUT_SELECTOR}, 1)`);
    assert.equal(questions[1]!.selector, `:nth-match(${VISIBLE_INPUT_SELECTOR}, 2)`);
  });

  it("groups an ARIA radio widget by the nearest preceding heading, in reading order", () => {
    const html = `
      <div role="heading">What is your availability? *</div>
      <div role="radio" aria-label="Full Hackathon" aria-checked="false"></div>
      <div role="radio" aria-label="Half day" aria-checked="false"></div>
    `;
    const questions = inspectApplicationForm(html);
    const group = questions.find((q) => q.label === "What is your availability? *");
    assert.ok(group);
    assert.equal(group!.fieldType, "radio");
    assert.equal(group!.required, true);
    assert.deepEqual(group!.options, ["Full Hackathon", "Half day"]);
    assert.equal(
      group!.selector,
      `:nth-match(${ARIA_CHOICE_SELECTOR}, 1), :nth-match(${ARIA_CHOICE_SELECTOR}, 2)`,
    );
  });

  it("groups an ARIA checkbox widget separately from a following ARIA radio widget", () => {
    const html = `
      <div role="heading">Pick your skills</div>
      <div role="checkbox" aria-label="Writing code" aria-checked="false"></div>
      <div role="checkbox" aria-label="Design" aria-checked="false"></div>
      <div role="heading">Availability</div>
      <div role="radio" aria-label="Morning" aria-checked="false"></div>
    `;
    const questions = inspectApplicationForm(html);
    const skills = questions.find((q) => q.label === "Pick your skills");
    const availability = questions.find((q) => q.label === "Availability");
    assert.equal(skills!.fieldType, "checkbox");
    assert.deepEqual(skills!.options, ["Writing code", "Design"]);
    assert.equal(availability!.fieldType, "radio");
    assert.deepEqual(availability!.options, ["Morning"]);
  });

  it("treats an ARIA choice group as optional when neither aria-required nor a trailing asterisk is present", () => {
    const html = `
      <div role="heading">Anything you would like to add</div>
      <div role="checkbox" aria-label="Yes" aria-checked="false"></div>
    `;
    const questions = inspectApplicationForm(html);
    assert.equal(questions[0]!.required, false);
  });

  it("respects aria-required on the heading even without a trailing asterisk", () => {
    const html = `
      <div role="heading" aria-required="true">Pick one</div>
      <div role="radio" aria-label="A" aria-checked="false"></div>
    `;
    const questions = inspectApplicationForm(html);
    assert.equal(questions[0]!.required, true);
  });

  it("normalizes an empty/sentinel ARIA option value to a human 'Other' label", () => {
    const html = `
      <div role="heading">Pick one</div>
      <div role="radio" data-answer-value="Frontend" aria-checked="false"></div>
      <div role="radio" data-answer-value="__other_option__" aria-checked="false"></div>
    `;
    const questions = inspectApplicationForm(html);
    assert.deepEqual(questions[0]!.options, ["Frontend", "Other"]);
  });

  it("does not double-count a native input that redundantly sets an ARIA choice role", () => {
    const html = `
      <div role="heading">Pick one</div>
      <input type="radio" role="radio" name="x" value="A" />
    `;
    const questions = inspectApplicationForm(html);
    assert.equal(questions.length, 1);
    assert.equal(questions[0]!.fieldType, "radio");
    assert.equal(questions[0]!.selector, '[name="x"]');
  });

  it("keeps native and ARIA questions independent in a mixed form", () => {
    const html = `
      <label for="name">Name</label>
      <input id="name" type="text" />
      <div role="heading">Track</div>
      <div role="radio" aria-label="AI" aria-checked="false"></div>
      <div role="radio" aria-label="Web" aria-checked="false"></div>
    `;
    const questions = inspectApplicationForm(html);
    assert.equal(questions.length, 2);
    assert.equal(questions[0]!.label, "Name");
    assert.equal(questions[1]!.label, "Track");
    assert.deepEqual(questions[1]!.options, ["AI", "Web"]);
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
