# Ask UX Gap — Candidate Detail Answer Presentation

Read-only audit of Ask UI in `CandidateDetailView` / `AskAnswerCard`.  
Scope: Steps **6–9 presentation** (UI). Backend synthesis/routing is covered in `ASK_RUNTIME_AUDIT.md`; this doc only records what the UI must change to meet acceptance.

Date: 2026-07-12  
Primary file: `src/components/candidates/CandidateDetailView.tsx`  
Payload helper: `src/core/candidateAskDecision.ts` → `readPersistedAskPayload`

---

## 1. Current composer issues

Location: detail main column, nested `<section className="hf-panel px-4 py-3">` (no Ask section label).

| Aspect | Current | Gap |
|--------|---------|-----|
| Heading / chips / Ask button | Removed; placeholder `Ask about this event…` only | Keep (matches Step 9 “keep simplified composer”) |
| Submit | Enter submits; Shift+Enter newline; empty blocked; input cleared only on success | OK |
| Loading | Quiet `Thinking…` (`role="status"`) | OK; optional tighter inline spinner later |
| Visual weight | Nested panel + 3-row `resize-y` textarea + generic `hf-input` | Still reads as a bolted-on form island, not a research thread field |
| Thread | Answers append below as bordered list cards | Cards + `sky-300` source links fight blueprint restraint; no newest-first cue beyond store prepend |
| Error | Amber text under form | OK; failed input preserved |
| Empty thread | No answers → blank space under composer | Acceptable; do not reintroduce tutorial copy |

**Composer UI fixes (keep behavior, tighten presentation):**

- Treat Ask as a flat research-thread region (composer + answers), not a second nested “chat panel” chrome if blueprint panels already wrap the column.
- Keep one quiet multiline field; avoid re-adding heading, chips, or a visible Ask button.
- Style source links with blueprint ink tokens, not Tailwind `text-sky-300`.
- Prefer newest answer visually adjacent to composer (store already prepends; verify DOM order stays newest-first).

---

## 2. How `"low · live check"` is rendered

`AskAnswerCard` meta row (top-right of each answer):

```tsx
<span className="text-[11px] uppercase tracking-wider text-muted">
  {payload.kind === "decision" ? "decision · " : ""}
  {answer.confidence ?? "low"}
  {payload.liveVerification ? " · live check" : ""}
</span>
```

**What users see (uppercase):**

- Factual + live research: `LOW · LIVE CHECK`
- Factual, stored only: `LOW` / `MEDIUM` / `HIGH`
- Decision: `DECISION · LOW` (or medium/high); live flag rare on decision path today
- Missing confidence: defaults to **`low`** even when unknown

**Problems:**

- Raw enum tokens (`low`, `medium`, `high`), not human language.
- `"live check"` is jargon; Step 9 wants “Live verification used” / “Based on stored evidence”.
- `payload.certainty` is parsed (`confirmed` | `inferred` | `conflicting` | `unknown`) but **never shown**.
- `decision.confidence` is not preferred; card uses persisted `answer.confidence`.
- Tiny uppercase badge cluster overuses technical chrome (“decision · …” prefix).

**Target labels (Step 9):**

| Signal | Display |
|--------|---------|
| `high` | High confidence |
| `medium` | Moderate confidence |
| `low` | Limited evidence |
| `liveVerification === true` | Live verification used *(only when useful)* |
| else / stored path | Based on stored evidence *(optional; omit if redundant)* |

Do not show both live + stored. Do not default missing confidence to “low” without evidence — prefer omit or “Limited evidence” only when API actually returned low.

---

## 3. How decision vs factual answers render

### Factual (no `payload.decision`)

```tsx
<p className="mt-1 text-sm text-foreground/80">{answer.answer}</p>
```

Then optional link chips from `payload.links`.

**Result:** one undifferentiated prose blob. Certainty, supporting facts, and citation hierarchy are not structured. Backend prefixes/addenda become visible copy (see §4).

### Decision (`payload.decision` present)

Structured blocks:

1. Mono uppercase recommendation (`strong yes` / `maybe` / …) + `headline`
2. **Why** — bullet list (`reasons`)
3. **Concerns** — bullets
4. **Missing** — bullets
5. **Next step** — inline label + `nextStep`
6. Link chips from `payload.links` (citations)

Persisted `answer.answer` (`formatDecisionAnswer` prose) is **hidden** when decision object exists — good.

**Gaps:**

- Recommendation stamp is weak mono text, not a clear advisory stamp.
- No dedicated confidence line using Step 9 wording (only cryptic meta badge).
- Section density is fine for decision; factual path has none of this structure.
- Empty reason/concern/missing sections are correctly omitted; keep that.

---

## 4. Raw snippet leakage in UI

### Mechanism (backend → UI)

Factual research in `candidateQuestionAnswer.ts` writes SERP text into `answer.answer`:

- `Live search found related notes (still verify on the official page): ${snippet}`
- `${local.answer} Live search addendum: ${snippet}`

where `snippet` = joined `title: snippet | …` (≤500 chars).

UI **renders `answer.answer` verbatim** on the factual branch. There is no client-side strip, no “evidence only” bucket, and no separate field for synthesized prose vs research dump.

Also leaked into the same paragraph when baked into strings:

- `Inferred from available evidence: …`
- `Evidence may conflict: …`
- Catch-all / concatenated stored notes for underspecified asks (e.g. `"date?"` — see runtime audit)

Decision path does not append live snippets today; leakage is primarily **factual AskAnswerCard**.

### UI responsibility (even while backend is fixed)

- Factual card must not present research dumps as the primary answer.
- Prefer rendering structured fields once API provides them (`answer`, `certainty`, citations).
- Until then, presentation should favor short lead sentence + citations; avoid styling the full blob as authoritative investigation prose.
- Never reintroduce chips that paste raw evidence titles as suggested questions.

---

## 5. Exact component changes for Steps 6–9 UI (not backend)

All changes in / extracted from `CandidateDetailView.tsx` unless noted. Optional small presentational helpers may live beside the card (e.g. `askConfidenceLabel.ts`) — no API/route edits in this UI track.

### Step 6 UI — Direct factual layout

In `AskAnswerCard`, when `!decision` (factual):

1. **Lead answer** — short primary paragraph (`answer.answer` once clean; max visual ~1–3 short blocks).
2. **Certainty line** — map `payload.certainty` (and future `likely` if API aligns) to plain language:
   - confirmed → Confirmed
   - inferred / likely → Likely / Inferred
   - unclear / unknown → Unclear
   - conflicting → Conflicting
3. **Citations** — show at most **1–3** links; prefer official/apply labels; truncate long labels; blueprint link style.
4. Do **not** render raw multi-pipe search dumps as body copy; if legacy answers still contain `Live search addendum:` / `Live search found related notes`, hide or collapse that suffix in the factual body (presentation guard) until Step 8 cleans persistence.
5. Stop using the `LOW · LIVE CHECK` meta cluster for factual; use Step 9 confidence language instead.

### Step 7 UI — Decision layout polish (LLM content assumed)

Keep structured decision sections; polish only:

1. Recommendation as a restrained **status stamp** (tone by level: strong_yes/yes → approve-adjacent; maybe → amber; no/strong_no → reject-adjacent) — not generic SaaS pills.
2. Headline as primary sentence; reasons / concerns / missing / next step unchanged in order.
3. Confidence from decision payload with Step 9 wording.
4. Compact sources (same 1–3 citation rule).
5. Do not also print `formatDecisionAnswer` prose under the structure.

### Step 8 UI — No snippet presentation

1. Factual card assumes research is **internal**; UI never labels body text as “live search addendum”.
2. Live verification, if shown, is a **status phrase**, not pasted SERP content.
3. Source chips show curated labels/URLs only — not concatenated title+snippet strings.

### Step 9 UI — Meta language + compact layouts

1. Replace meta badge builder with label helpers (confidence + optional live/stored).
2. Show live-verification status **only when** `liveVerification` is true and it adds trust context; otherwise omit.
3. Remove `decision ·` prefix from the badge; kind is obvious from layout.
4. Composer: preserve simplified behavior; only visual quieting as needed.
5. Answer list: less card chrome (border/bg) — thread items, not chat bubbles.

**Suggested structure (illustrative):**

```tsx
function AskAnswerCard({ answer }) {
  const payload = readPersistedAskPayload(answer.sources);
  if (payload.decision) return <DecisionAnswerLayout ... />;
  return <FactualAnswerLayout ... />;
}
```

Split layout components in the same file or `AskAnswerCard.tsx` — avoid new product features.

---

## 6. Acceptance criteria — compact factual vs decision

### Composer (both)

- [ ] No “Ask anything” heading, suggestion chips, or visible Ask button
- [ ] Enter submits; Shift+Enter newline; empty submit blocked; failed input preserved
- [ ] Quiet loading only

### Compact factual layout

- [ ] Answer leads; ≤ ~1–3 short paragraphs of relevant text
- [ ] Certainty shown in plain language when known
- [ ] ≤ 3 citation links; no duplicate URLs
- [ ] **No** `Live search addendum`, pipe-joined `title: snippet` dumps, or unrelated eligibility walls in the body
- [ ] Confidence uses High / Moderate / Limited evidence — not `LOW`
- [ ] “Live verification used” only when live research informed the answer

### Decision layout

- [ ] Recommendation + headline first
- [ ] Why / Concerns / Missing / Next step (omit empty)
- [ ] Confidence in plain language
- [ ] Compact sources (≤ 3)
- [ ] No second prose dump of the serialized decision string
- [ ] No raw research snippets in body

### Visual

- [ ] Blueprint-consistent link/stamp styling (no `sky-300` chat links)
- [ ] Meta chrome restrained — no uppercase enum soup
- [ ] Passes Ask factual + decision screenshot checks in later visual QA

---

## 7. UI fixes needed (summary checklist)

1. Split `AskAnswerCard` into compact **factual** vs **decision** layouts.
2. Replace `confidence + " · live check"` uppercase enum badge with Step 9 plain-language confidence / evidence labels.
3. Surface `payload.certainty` on factual answers; stop ignoring it.
4. Cap citations at 1–3; restyle links to blueprint tokens (drop `text-sky-300`).
5. Presentation-guard factual body against legacy `Live search addendum` / SERP dump suffixes.
6. Decision: stronger recommendation stamp; use decision confidence wording; never show serialized `answer.answer` when structured decision exists.
7. Quiet composer/thread chrome (less nested chat-card feel); keep no heading/chips/Ask button.
8. Only show live-verification status when useful; never imply live check via raw snippet text.
9. Default missing confidence carefully — do not force `"low"` label when absent.
10. Verify newest answers stay adjacent to the composer in the thread list.
