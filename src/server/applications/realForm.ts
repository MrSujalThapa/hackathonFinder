import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Locator, Page } from "playwright";
import type { ApplicationDraft, ApplicationQuestion } from "@/core/applications/types";
import { beginSubmission } from "@/core/applications/workflow";
import { classifyFormAction } from "@/core/applications/navigationSafety";
import { reconcileExternalForm, splitMultiValue, type ExternalFormControl, type ReconciliationResult } from "@/core/applications/formReconciliation";
import { ariaChoiceOptionValue } from "@/core/applications/formInspection";
import { withPersistentPlaywright } from "@/lib/browser/persistent";
import { resolveSourceProfileDir } from "@/lib/browser/profilePaths";
import { assertSafeCustomSourceUrl } from "@/server/customSources/urlSafety";
import { downloadAssetFile, isStoredAsset } from "@/server/applications/assetStorage";

const fixturePath = "/fixtures/controlled-application";
export const isControlledApplicationFixture = (url: string) => { const parsed = new URL(url); return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && parsed.pathname === fixturePath; };

/** True when the locator's first match is a custom ARIA radio/checkbox widget (no native <input>). */
async function isAriaChoiceGroup(locator: Locator): Promise<boolean> {
  return locator.first().evaluate((element) => {
    const role = element.getAttribute("role");
    return element.tagName !== "INPUT" && (role === "radio" || role === "checkbox");
  });
}

async function ariaOptionRawValue(option: Locator): Promise<string> {
  return option.evaluate((element) => element.getAttribute("data-answer-value") ?? element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "");
}

async function controlsFor(page: Page, questions: ApplicationQuestion[]): Promise<ExternalFormControl[]> {
  return Promise.all(questions.map(async (question) => {
    const locator = page.locator(question.selector); const count = await locator.count(); if (!count) return { selector: question.selector, label: "", name: "", id: "", fieldType: question.fieldType, required: question.required, options: [], value: null };
    if (await isAriaChoiceGroup(locator)) {
      const optionStates = await locator.evaluateAll((elements) => elements.map((element) => ({
        value: element.getAttribute("data-answer-value") ?? element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
        checked: element.getAttribute("aria-checked") === "true",
        // No standardized native attribute carries "required" for a custom
        // ARIA widget; aria-required on the option or an ancestor group
        // container is the general, DOM-verifiable signal.
        required: element.getAttribute("aria-required") === "true" || element.closest('[aria-required="true"]') != null,
      })));
      const options = optionStates.map((option) => ariaChoiceOptionValue(option.value));
      const selected = optionStates.filter((option) => option.checked).map((option) => ariaChoiceOptionValue(option.value));
      return {
        selector: question.selector,
        // No independent native identity (id/name) exists for a custom ARIA
        // widget; the label match against `question.label` is trivially true.
        label: question.label,
        name: "",
        id: "",
        fieldType: question.fieldType,
        required: optionStates.some((option) => option.required),
        options,
        value: selected.length ? selected.join(", ") : null,
        checked: selected.length > 0,
      };
    }
    return locator.first().evaluate((element, selector) => {
      const input = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const labels = input.labels ? Array.from(input.labels).map((label) => label.textContent?.trim() ?? "").filter(Boolean) : [];
      const group = input.name && (input.type === "radio" || input.type === "checkbox") ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(input.name)}"]`)) : [input as HTMLInputElement];
      const selected = group.filter((item) => item.checked);
      // Standard aria-labelledby="id1 id2" accessible-name pattern (e.g. Google
      // Forms) — takes priority per the ARIA accname spec, same as native labels.
      const labelledById = input.getAttribute("aria-labelledby");
      const labelledByText = labelledById
        ? labelledById
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .filter(Boolean)
            .join(" ")
        : "";
      return { selector, label: labelledByText || input.getAttribute("aria-label") || labels[0] || input.closest("fieldset")?.querySelector("legend")?.textContent?.trim() || input.name || input.id, name: input.name, id: input.id, fieldType: input.tagName.toLowerCase() === "select" ? "select" : input.type, required: input.required, options: input instanceof HTMLSelectElement ? Array.from(input.options).map((option) => option.text) : group.map((item) => item.value), value: input.type === "file" ? null : (selected.length > 1 ? selected.map((item) => item.value).join(", ") : (selected[0]?.value ?? input.value ?? null)), checked: selected.length > 0, files: input instanceof HTMLInputElement && input.type === "file" ? Array.from(input.files ?? []).map((file) => file.name) : [] };
    }, question.selector);
  }));
}

/** Clicks an ARIA radio/checkbox option only if its current state differs from `desired` — never double-toggles. */
async function setAriaOptionChecked(option: Locator, desired: boolean): Promise<void> {
  const current = await option.getAttribute("aria-checked");
  if ((current === "true") !== desired) await option.click();
}

async function fillAriaChoiceGroup(question: ApplicationQuestion, locator: Locator): Promise<void> {
  const count = await locator.count();
  const options: Locator[] = [];
  for (let index = 0; index < count; index += 1) options.push(locator.nth(index));

  if (question.fieldType === "radio") {
    const desired = question.answer!;
    for (const option of options) {
      const value = ariaChoiceOptionValue(await ariaOptionRawValue(option));
      if (value === desired) { await setAriaOptionChecked(option, true); return; }
    }
    throw new Error(`No matching option for ${question.label}: ${desired}`);
  }

  // Grouped checkbox — the answer is a set of desired selections; every
  // option is driven to the correct checked/unchecked state so a re-fill is
  // idempotent and never leaves a stale, previously-checked option behind.
  const desiredSet = new Set(splitMultiValue(question.answer!));
  for (const option of options) {
    const value = ariaChoiceOptionValue(await ariaOptionRawValue(option));
    await setAriaOptionChecked(option, desiredSet.has(value));
  }
}

async function fillQuestion(page: Page, question: ApplicationQuestion): Promise<void> {
  if (!question.answer) return;
  const locator = page.locator(question.selector); if (!await locator.count()) throw new Error(`Mapped field is missing: ${question.label}`);
  if (question.fieldType === "file") {
    let filePath = question.answer;
    if (isStoredAsset(filePath)) {
      const stored = await downloadAssetFile(filePath);
      if (!stored) throw new Error(`Required asset is unavailable: ${question.label}`);
      filePath = path.join(tmpdir(), `hackfinder-${randomUUID()}-${stored.filename}`);
      writeFileSync(filePath, Buffer.from(await stored.data.arrayBuffer()), { mode: 0o600 });
    }
    if (!existsSync(filePath)) throw new Error(`Required asset is not available locally: ${question.label}`);
    await locator.first().setInputFiles(path.resolve(filePath)); return;
  }
  if (question.fieldType === "select") { await locator.first().selectOption({ label: question.answer }); return; }
  if ((question.fieldType === "radio" || question.fieldType === "checkbox") && await isAriaChoiceGroup(locator)) {
    await fillAriaChoiceGroup(question, locator);
    return;
  }
  if (question.fieldType === "radio") { await page.locator(`${question.selector}[value="${question.answer}"]`).check(); return; }
  if (question.fieldType === "checkbox") {
    if (question.options.length > 1) {
      // Grouped native checkboxes: drive every option to match the desired set.
      const desiredSet = new Set(splitMultiValue(question.answer));
      const count = await locator.count();
      for (let index = 0; index < count; index += 1) {
        const option = locator.nth(index);
        const value = (await option.getAttribute("value")) ?? "on";
        if (desiredSet.has(value)) await option.check(); else await option.uncheck();
      }
      return;
    }
    if (["yes", "true", "1", "on"].includes(question.answer.toLowerCase())) await locator.first().check(); else await locator.first().uncheck();
    return;
  }
  await locator.first().fill(question.answer);
}

export type RealFormRun = { applicationUrl: string; page: number; reconciliation: ReconciliationResult; confirmation?: string };

/** Reconstructs a persistent application browser profile and only uses verified safe navigation. */
export async function fillAndPreviewRealForm(draft: ApplicationDraft): Promise<RealFormRun> {
  const controlled = isControlledApplicationFixture(draft.applicationUrl);
  if (!controlled) await assertSafeCustomSourceUrl(draft.applicationUrl);
  return withPersistentPlaywright(resolveSourceProfileDir(`application-${draft.id}`), async ({ page }) => {
    await page.goto(draft.applicationUrl, { waitUntil: "domcontentloaded" });
    if (controlled) {
      await page.getByTestId("fixture-ready").waitFor({ state: "attached" });
    } else {
      // Same real-world timing gap as inspectApplicationUrl: many real forms
      // (Google Forms, custom SPAs) render their fields client-side after
      // domcontentloaded. Filling before that finishes silently mis-targets
      // (or misses) fields, since `:nth-match`/positional selectors depend on
      // the full live element set already being present.
      await page
        .locator("input, textarea, select")
        .first()
        .waitFor({ state: "attached", timeout: 8_000 })
        .catch(() => undefined);
    }
    const totalPages = controlled ? Number((await page.getByTestId("fixture-page").innerText()).match(/of\s+(\d+)/)?.[1] ?? 1) : 1;

    // Fill and read back non-ARIA fields BEFORE touching any ARIA choice
    // widget. Verified on a real form (Google Forms): the first interaction
    // with a custom role="radio"/"checkbox" widget lazily inserts a new
    // hidden mirror <input> ahead of the visible native fields, shifting
    // every later `:nth-match(input, textarea, select, N)` position. Reading
    // native fields back first means that shift can never corrupt them;
    // ARIA-role positional selectors are unaffected either way since
    // clicking toggles `aria-checked` in place rather than adding/removing
    // role="radio"/"checkbox" elements.
    const ariaQuestions: ApplicationQuestion[] = [];
    const nativeQuestions: ApplicationQuestion[] = [];
    for (const question of draft.questions) {
      const isAria =
        (question.fieldType === "radio" || question.fieldType === "checkbox") &&
        (await isAriaChoiceGroup(page.locator(question.selector)).catch(() => false));
      (isAria ? ariaQuestions : nativeQuestions).push(question);
    }

    for (let current = 1; current <= totalPages; current += 1) {
      for (const question of nativeQuestions) if (await page.locator(question.selector).first().isVisible().catch(() => false)) await fillQuestion(page, question);
      if (controlled && current < totalPages) {
        const button = page.locator("[data-fixture-next]"); const safety = classifyFormAction({ tagName: "button", type: await button.getAttribute("type") ?? undefined, text: await button.innerText(), currentPage: current, totalPages });
        if (safety !== "SAFE_NAVIGATION") throw new Error("Form navigation is not deterministically safe.");
        await button.click(); await page.locator(`[data-fixture-page="${current + 1}"]`).waitFor({ state: "visible" });
      }
    }
    const nativeControls = await controlsFor(page, nativeQuestions);

    for (const question of ariaQuestions) if (await page.locator(question.selector).first().isVisible().catch(() => false)) await fillQuestion(page, question);
    const ariaControls = await controlsFor(page, ariaQuestions);

    const controls = [...nativeControls, ...ariaControls];
    return { applicationUrl: draft.applicationUrl, page: totalPages, reconciliation: reconcileExternalForm(draft.questions, controls) };
  }, { timeoutMs: 30_000 });
}

/** Executes only the controlled fixture's final action after the caller has checked authorization and reconciliation. */
export async function submitControlledRealForm(draft: ApplicationDraft): Promise<RealFormRun> {
  if (!isControlledApplicationFixture(draft.applicationUrl)) throw new Error("External submission is disabled unless the user explicitly provides and authorizes a safe target.");
  const preview = await fillAndPreviewRealForm(draft); if (!preview.reconciliation.ok) return preview;
  return withPersistentPlaywright(resolveSourceProfileDir(`application-${draft.id}`), async ({ page }) => {
    await page.goto(draft.applicationUrl, { waitUntil: "domcontentloaded" });
    await page.getByTestId("fixture-ready").waitFor({ state: "attached" });
    const totalPages = Number((await page.getByTestId("fixture-page").innerText()).match(/of\s+(\d+)/)?.[1] ?? 1);
    for (let current = 1; current <= totalPages; current += 1) { for (const question of draft.questions) if (await page.locator(question.selector).first().isVisible().catch(() => false)) await fillQuestion(page, question); if (current < totalPages) { await page.locator("[data-fixture-next]").click(); await page.locator(`[data-fixture-page="${current + 1}"]`).waitFor({ state: "visible" }); } }
    const final = page.locator("[data-fixture-final]"); const safety = classifyFormAction({ tagName: "button", type: await final.getAttribute("type") ?? undefined, text: await final.innerText(), currentPage: totalPages, totalPages });
    if (safety === "SAFE_NAVIGATION") throw new Error("Final action was incorrectly classified as safe navigation.");
    await final.click(); const confirmation = await page.getByTestId("fixture-confirmation").innerText();
    return { ...preview, confirmation };
  }, { timeoutMs: 30_000 });
}

/**
 * Finds a visible control whose type/text unambiguously classifies as a
 * final submit action, using the same conservative, general classifier the
 * fixture path already relies on. `button`/`input[type=submit]` cover
 * standards-based HTML forms; `[role="button"]`/`a[role="button"]` cover the
 * custom-widget submit controls common on real SPA-built forms (Google
 * Forms among them). Never guesses: returns null rather than picking an
 * ambiguous (POSSIBLE_SUBMIT) or safe-navigation control.
 */
export async function findRealSubmitControl(page: Page): Promise<Locator | null> {
  const candidates = page.locator('button, input[type="submit"], input[type="button"], [role="button"], a[role="button"]');
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const evidence = await candidate.evaluate((element) => ({
      tagName: element.tagName.toLowerCase(),
      type: element.getAttribute("type") ?? undefined,
      text: element.textContent?.trim() ?? "",
    }));
    if (classifyFormAction(evidence) === "CONFIRMED_SUBMIT") return candidate;
  }
  return null;
}

/**
 * General real-external-form submission — the production counterpart to
 * `submitControlledRealForm` for any non-fixture applicationUrl. Reachable
 * only behind explicit, version-bound "Submit now" authorization:
 * `beginSubmission` (the same check every other submission path already
 * goes through) is asserted independently here too, as defense in depth —
 * this function must never trust that a caller already checked it.
 *
 * Runs one more fully independent fill + reconciliation pass immediately
 * before the irreversible click (never submits against a state that wasn't
 * just re-verified in this exact pass), then locates the real submit
 * control with `findRealSubmitControl` and clicks it exactly once.
 */
export async function submitRealExternalForm(draft: ApplicationDraft): Promise<RealFormRun> {
  beginSubmission(draft);
  if (isControlledApplicationFixture(draft.applicationUrl)) throw new Error("Use submitControlledRealForm for the local fixture.");
  await assertSafeCustomSourceUrl(draft.applicationUrl);

  const preview = await fillAndPreviewRealForm(draft);
  if (!preview.reconciliation.ok) return preview;

  return withPersistentPlaywright(resolveSourceProfileDir(`application-${draft.id}`), async ({ page }) => {
    await page.goto(draft.applicationUrl, { waitUntil: "domcontentloaded" });
    await page.locator("input, textarea, select").first().waitFor({ state: "attached", timeout: 8_000 }).catch(() => undefined);

    const ariaQuestions: ApplicationQuestion[] = [];
    const nativeQuestions: ApplicationQuestion[] = [];
    for (const question of draft.questions) {
      const isAria =
        (question.fieldType === "radio" || question.fieldType === "checkbox") &&
        (await isAriaChoiceGroup(page.locator(question.selector)).catch(() => false));
      (isAria ? ariaQuestions : nativeQuestions).push(question);
    }
    for (const question of nativeQuestions) if (await page.locator(question.selector).first().isVisible().catch(() => false)) await fillQuestion(page, question);
    const nativeControls = await controlsFor(page, nativeQuestions);
    for (const question of ariaQuestions) if (await page.locator(question.selector).first().isVisible().catch(() => false)) await fillQuestion(page, question);
    const ariaControls = await controlsFor(page, ariaQuestions);

    const reconciliation = reconcileExternalForm(draft.questions, [...nativeControls, ...ariaControls]);
    if (!reconciliation.ok) return { applicationUrl: draft.applicationUrl, page: 1, reconciliation };

    const control = await findRealSubmitControl(page);
    if (!control) throw new Error("Could not confidently identify a submit control on the real form; refusing to guess.");
    await control.click();
    const confirmation = await page.locator("body").innerText().then((text) => text.slice(0, 500)).catch(() => "Submitted (confirmation text unavailable)");
    return { applicationUrl: draft.applicationUrl, page: 1, reconciliation, confirmation };
  }, { timeoutMs: 30_000 });
}
