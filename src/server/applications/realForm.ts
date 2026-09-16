import { existsSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { ApplicationDraft, ApplicationQuestion } from "@/core/applications/types";
import { classifyFormAction } from "@/core/applications/navigationSafety";
import { reconcileExternalForm, type ExternalFormControl, type ReconciliationResult } from "@/core/applications/formReconciliation";
import { withPersistentPlaywright } from "@/lib/browser/persistent";
import { resolveSourceProfileDir } from "@/lib/browser/profilePaths";

const fixturePath = "/fixtures/controlled-application";
export const isControlledApplicationFixture = (url: string) => { const parsed = new URL(url); return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && parsed.pathname === fixturePath; };

async function controlsFor(page: Page, questions: ApplicationQuestion[]): Promise<ExternalFormControl[]> {
  return Promise.all(questions.map(async (question) => {
    const locator = page.locator(question.selector); const count = await locator.count(); if (!count) return { selector: question.selector, label: "", name: "", id: "", fieldType: question.fieldType, required: question.required, options: [], value: null };
    return locator.first().evaluate((element, selector) => {
      const input = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const labels = input.labels ? Array.from(input.labels).map((label) => label.textContent?.trim() ?? "").filter(Boolean) : [];
      const group = input.name && (input.type === "radio" || input.type === "checkbox") ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(input.name)}"]`)) : [input as HTMLInputElement];
      const selected = group.find((item) => item.checked);
      return { selector, label: input.getAttribute("aria-label") ?? labels[0] ?? input.closest("fieldset")?.querySelector("legend")?.textContent?.trim() ?? input.name ?? input.id, name: input.name, id: input.id, fieldType: input.tagName.toLowerCase() === "select" ? "select" : input.type, required: input.required, options: input instanceof HTMLSelectElement ? Array.from(input.options).map((option) => option.text) : group.map((item) => item.value), value: input.type === "file" ? null : (selected?.value ?? input.value ?? null), checked: selected?.checked, files: input instanceof HTMLInputElement && input.type === "file" ? Array.from(input.files ?? []).map((file) => file.name) : [] };
    }, question.selector);
  }));
}

async function fillQuestion(page: Page, question: ApplicationQuestion): Promise<void> {
  if (!question.answer) return;
  const locator = page.locator(question.selector); if (!await locator.count()) throw new Error(`Mapped field is missing: ${question.label}`);
  if (question.fieldType === "file") { if (!existsSync(question.answer)) throw new Error(`Required asset is not available locally: ${question.label}`); await locator.first().setInputFiles(path.resolve(question.answer)); return; }
  if (question.fieldType === "select") { await locator.first().selectOption({ label: question.answer }); return; }
  if (question.fieldType === "radio") { await page.locator(`${question.selector}[value="${question.answer}"]`).check(); return; }
  if (question.fieldType === "checkbox") { if (["yes", "true", "1", "on"].includes(question.answer.toLowerCase())) await locator.first().check(); else await locator.first().uncheck(); return; }
  await locator.first().fill(question.answer);
}

export type RealFormRun = { applicationUrl: string; page: number; reconciliation: ReconciliationResult; confirmation?: string };

/** Reconstructs a persistent application browser profile and only uses verified safe navigation. */
export async function fillAndPreviewRealForm(draft: ApplicationDraft): Promise<RealFormRun> {
  if (!isControlledApplicationFixture(draft.applicationUrl)) throw new Error("Real-form automation is disabled for non-fixture targets until a user explicitly configures external submission.");
  return withPersistentPlaywright(resolveSourceProfileDir(`application-${draft.id}`), async ({ page }) => {
    await page.goto(draft.applicationUrl, { waitUntil: "domcontentloaded" });
    const totalPages = Number((await page.getByTestId("fixture-page").innerText()).match(/of\s+(\d+)/)?.[1] ?? 1);
    for (let current = 1; current <= totalPages; current += 1) {
      for (const question of draft.questions) if (await page.locator(question.selector).first().isVisible().catch(() => false)) await fillQuestion(page, question);
      if (current < totalPages) {
        const button = page.locator("[data-fixture-next]"); const safety = classifyFormAction({ tagName: "button", type: await button.getAttribute("type") ?? undefined, text: await button.innerText(), currentPage: current, totalPages });
        if (safety !== "SAFE_NAVIGATION") throw new Error("Form navigation is not deterministically safe.");
        await button.click(); await page.locator(`[data-fixture-page="${current + 1}"]`).waitFor({ state: "visible" });
      }
    }
    const controls = await controlsFor(page, draft.questions);
    return { applicationUrl: draft.applicationUrl, page: totalPages, reconciliation: reconcileExternalForm(draft.questions, controls) };
  });
}

/** Executes only the controlled fixture's final action after the caller has checked authorization and reconciliation. */
export async function submitControlledRealForm(draft: ApplicationDraft): Promise<RealFormRun> {
  const preview = await fillAndPreviewRealForm(draft); if (!preview.reconciliation.ok) return preview;
  return withPersistentPlaywright(resolveSourceProfileDir(`application-${draft.id}`), async ({ page }) => {
    await page.goto(draft.applicationUrl, { waitUntil: "domcontentloaded" });
    const totalPages = Number((await page.getByTestId("fixture-page").innerText()).match(/of\s+(\d+)/)?.[1] ?? 1);
    for (let current = 1; current <= totalPages; current += 1) { for (const question of draft.questions) if (await page.locator(question.selector).first().isVisible().catch(() => false)) await fillQuestion(page, question); if (current < totalPages) { await page.locator("[data-fixture-next]").click(); await page.locator(`[data-fixture-page="${current + 1}"]`).waitFor({ state: "visible" }); } }
    const final = page.locator("[data-fixture-final]"); const safety = classifyFormAction({ tagName: "button", type: await final.getAttribute("type") ?? undefined, text: await final.innerText(), currentPage: totalPages, totalPages });
    if (safety === "SAFE_NAVIGATION") throw new Error("Final action was incorrectly classified as safe navigation.");
    await final.click(); const confirmation = await page.getByTestId("fixture-confirmation").innerText();
    return { ...preview, confirmation };
  });
}
