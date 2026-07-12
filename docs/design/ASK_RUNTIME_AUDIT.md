# Ask Runtime Audit (STEP 5)

Investigation only — no production Ask behavior changes.
Date: 2026-07-12  
Helper: `scripts/debug-ask-runtime.ts` (fixture simulation; does not call live OpenAI/Tavily)

## Runtime map

```
POST /api/candidates/[id]/ask
  → protectApiRequest (same-origin, 2KB body, rateLimit candidate-ask 10/min)
  → load candidate
  → createSearchProviderOptional() + createLlmProviderOptional({ instrument: false })
  → answerCandidateQuestion(candidate, question, { searchProvider, llmProvider, maxSearchCalls: 1 })
       → classifyCandidateQuestion(trimmed)
       → if decision: answerDecisionQuestion(...)  // early return; no local facts; no live search
       → else: answerLocally(...) then maybe researchOnce() + append/replace answer
  → persist answer + sources blob (links, certainty, liveVerification, kind, decision)
  → return JSON (never mutates status / Sheets)
```

## Env at audit time (`.env.local`, secrets redacted)

| Key | Present |
| --- | --- |
| `LLM_PROVIDER` | `openai` |
| `LLM_API_KEY` | set |
| `LLM_MODEL` | `gpt-4o-mini` |
| `SEARCH_PROVIDER` | `tavily` |
| `SEARCH_API_KEY` | set |

Implication: production Ask **will** attempt OpenAI for decision questions and **will** run Tavily when factual `needsResearch` is true.

---

## Question 1 — `"date?"`

### Classifier

| Field | Result |
| --- | --- |
| `classifyCandidateQuestion("date?")` | **`factual`** |
| Why | No decision-signal regex match (`should i`, `worth`, `recommend`, etc.) |

### Local factual path

`answerLocally` has **no** handler for date / when / schedule / start / end.

Dedicated factual handlers exist for: uncertainty gaps, deadline, deadline-vs-event, mode/remote, location, eligibility, team, prize, judging, summarize/build, registration open, apply link, why-match.

`"date?"` falls through to the **catch-all blob dump** (`candidateQuestionAnswer.ts` ~427–441):

- Builds `blob` = summary + description + evidence text (truncated)
- Returns certainty **`inferred`**, confidence **`low`**
- Answer shape:  
  `Inferred from available evidence: I can only confirm what is already stored. Relevant notes: <blob…>`

**Critical:** fixture/candidate had `startDate`, `endDate`, and `deadline` populated; none are read for `"date?"`. Dates appear in the decision `candidateBrief` only, not in this factual branch.

### Short factual answers?

| Topic | Short confirmed answer? |
| --- | --- |
| Deadline (when asked as deadline) | Yes |
| Mode / location / eligibility / prize (when fields present) | Yes |
| **Event dates via `"date?"` / when / schedule** | **No** — catch-all only |

### Live search

`needsResearch("date?", local)`:

- `certainty !== confirmed || confidence !== high` → continues
- `confidence === "low"` → **`true`**

With `searchProvider` + `maxSearchCalls: 1` (route always passes both when search configured):

1. `researchOnce` builds query: `"${name} date ${city|location} hackathon"` (≤160 chars)
2. Takes up to 3 results; joins `title: snippet` into a ≤500-char string
3. Because local certainty is **`inferred`** (not `unknown`), merge path is:

```text
`${local.answer} Live search addendum: ${researched.snippet}`
```

Also: downgrades confidence high→medium (N/A here), certainty confirmed→inferred (N/A), sets `liveVerification: true`, merges search URLs into sources.

### LLM

**Not attempted.** Factual path never calls `generateJson` / LLM.

### Simulated outcome (fixture + mock search)

```text
Inferred from available evidence: I can only confirm what is already stored.
Relevant notes: Build agent tools… Official Teams of 1-4. Event runs Aug 1-3.
Live search addendum: Random blog about dates: Unrelated SEO copy…
```

### Root cause (Q1)

1. Missing date/event-schedule factual handler despite stored `startDate`/`endDate`/`deadline`.
2. Catch-all returns low-confidence blob → always triggers research when search is configured.
3. Research path **concatenates raw SERP snippets** into the user-visible answer (`Live search addendum`), producing snippet leakage / noise.

---

## Question 2 — `"Should I do this hackathon?"`

### Classifier

| Field | Result |
| --- | --- |
| `classifyCandidateQuestion("Should I do this hackathon?")` | **`decision`** |
| Why | `\bshould i\b` in `decisionSignals` |

### Path

Early return into `answerDecisionQuestion` — **skips** `answerLocally` and **skips** live search entirely (even if Tavily is configured).

### LLM attempted / succeeded / discarded

| Condition | Behavior |
| --- | --- |
| `llmProvider === undefined` | Creates optional provider from env |
| Route passes `createLlmProviderOptional(...)` | Env openai+key → **non-null provider** → **LLM attempted** |
| Success | `generateJson` + `parseDecisionRecommendation` → structured `decision` + `formatDecisionAnswer` |
| `llmProvider === null` / unconfigured | Soft message; **no** deterministic recommendation template |
| Provider throws / bad JSON | Empty `catch` → soft failure message; **error discarded** (no log, no `decision`) |

Prompt restrictions:

- System: advise attend/skip; say when preferences unavailable; cite only brief URLs; no invented facts; no search-snippet dumps; no disclaimer walls
- User: question + `candidateBrief` + allowed citation URLs
- `temperature: 0.2`
- **`maxOutputTokens: 700`** (hardcoded; Ask uses `instrument: false`, so `DEFAULT_MAX_OUTPUT_TOKENS` 800 / env `LLM_MAX_OUTPUT_TOKENS` are unused on this path)
- Strict JSON schema `hackathon_decision`

Preferences: **not loaded**. Prompt only says owner preference storage may be unavailable; advice is generic when that applies.

### Deterministic fallback — does it always win?

**No.** With current `.env.local`, LLM is configured → structured LLM answer is the primary path.

Deterministic code **never** authors a yes/maybe/no template. Fallbacks are refusal/error strings only:

- Missing LLM: *“I can only give advisory recommendations when an LLM provider is configured…”*
- LLM failure: *“Could not complete an advisory recommendation right now…”*

### Live search / snippet leakage on decision path?

**None.** Decision returns before research. Leakage for this question only appears if it were misclassified as factual (it is not).

### Simulated outcomes

| Mode | Result |
| --- | --- |
| Fake LLM success | `kind: decision`, structured recommendation, formatted answer; `liveVerification: false`; search ignored |
| `llmProvider: null` | Soft refuse; no `decision` |
| LLM throws | Soft refuse; no `decision`; exception swallowed |

### Root cause candidates (Q2 failure modes)

If users see bad advisory UX with LLM configured:

1. **Silent discard** of LLM errors (empty `catch`) → looks like “Ask failed softly” with no structured card.
2. Certainty quirks: non-high confidence + any `missingInformation` → `certainty: "unknown"` even when recommendation succeeded (UI may look weaker than the advice).
3. No owner preferences in context → generic advice (by design today).
4. If LLM were **unconfigured**, users only get the configure-LLM message — not a heuristic recommendation (intentional per decision-LLM-first rule).

If users see research dumps on this question: that would **not** come from this classifier path; investigate UI mixing threads or a different question string.

---

## Research snippet leakage mechanism (factual)

Exact append points in `answerCandidateQuestion`:

| Local certainty | User-visible answer |
| --- | --- |
| `unknown` | Replaces with: `Live search found related notes (still verify…): ${snippet}` |
| otherwise (incl. catch-all `inferred`) | Appends: `${local.answer} Live search addendum: ${snippet}` |

`snippet` = raw `title: snippet` joins from search provider (≤500 chars). **No LLM synthesis, no cite-check, no field extraction.**

`needsResearch` gates this aggressively: any `unknown` / `low` confidence local answer triggers search when provider exists. Catch-all and many gap handlers are low/unknown → leakage is common for underspecified factual asks like `"date?"`.

---

## Max tokens / prompt restrictions summary

| Control | Ask decision path |
| --- | --- |
| Output tokens | Hardcoded **700** |
| Env `LLM_MAX_OUTPUT_TOKENS` | **Not applied** (Ask `instrument: false`) |
| Temperature | 0.2 |
| Response format | Strict JSON schema |
| Citations | Prompt-limited to brief URLs; parser falls back to primary sources |
| Factual LLM | **None** |
| Question length | Route Zod 1–500 |
| Search calls | Cap 1 |

---

## Fallback when LLM missing

Decision only:

1. Optional provider null → configure-LLM message (`kind: "decision"`, no `decision` object).
2. No fallback to factual local answer.
3. No fallback to live search.
4. Does not invent `strong_yes`…`strong_no` deterministically.

---

## Architecture before / after (this step)

| | Before / current (audited) | After (not implemented) |
| --- | --- | --- |
| Classifier | Regex factual vs decision | Unchanged intent |
| Factual dates | Missing → blob + addendum | (planned) dedicated short date answer |
| Live search | Raw snippet append/replace | (planned) cite-only / synthesize / or skip when fields known |
| Decision | LLM-first JSON; soft refuse if missing/fail | (planned) keep LLM-first; surface/log failures |

---

## Recommended fix plan (bullets only)

- Add factual handlers for event dates (`date`, `when`, `schedule`, `start`, `end`) reading `startDate`/`endDate`/`deadline` with short confirmed answers when present.
- Stop catch-all from claiming “relevant notes” for underspecified questions; return a targeted unknown + field hints instead of dumping summary/evidence.
- Change `needsResearch` so confirmed structured fields (or answered-from-store dates) do not trigger SERP when the ask matches those fields.
- Never append raw `Live search addendum` text into `answer`; at most attach sources, or run a bounded extract/LLM cite step before user-visible prose.
- Keep decision path LLM-first; do not add deterministic yes/no templates.
- Log/rethrow-classify LLM failures instead of empty `catch`; return a distinct error code/message for UI.
- Optionally pass soft preference hints if/when owner prefs exist; until then keep explicit “generic advice” wording in the model system prompt.
- Align Ask `maxOutputTokens` with env/`instrument` defaults or document the intentional 700 cap.
- Extend unit tests: `"date?"` with populated dates; `"date?"` must not contain `Live search addendum` when dates are stored; decision still ignores search; LLM null/throw contracts.
- Leave `scripts/debug-ask-runtime.ts` for manual regression or delete after STEP 6.

---

## Files inspected

- `src/core/candidateQuestionAnswer.ts`
- `src/core/candidateAskDecision.ts`
- `src/app/api/candidates/[id]/ask/route.ts`
- `src/lib/llm/*` (createProvider, config, structured, openai, provider)
- `src/lib/search/createSearchProvider.ts`
- `src/core/candidateQuestionAnswer.test.ts`
- `src/components/candidates/CandidateDetailView.tsx` (answer presentation only)
- Helper added: `scripts/debug-ask-runtime.ts`
