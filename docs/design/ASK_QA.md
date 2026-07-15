# Ask QA — Step 11 implementation

Date: 2026-07-12  
Harness: `scripts/design-final-after-capture.ts`  
Artifacts: `artifacts/design/final-after/ask*.png`  
Candidate: mock `aaaaaaaa-aaaa-4aaa-8aaa-000000000001` (HackTO AI Challenge)  
Base: `http://localhost:3000` with `USE_MOCK_CANDIDATES=true`

## Method

1. Login via `/api/auth/login`, reset mock store.
2. Open first queue candidate detail (Ask composer visible).
3. POST via UI Enter submit:
   - Factual: `date?`
   - Decision: `Should I do this hackathon?`
4. Wait for `/ask` response; screenshot at 1440×1000.
5. Scan answer DOM for raw-snippet leak patterns (URLs dumps, `evidence[`, code fences, pipe tables).

## Results

| Prompt | Kind | HTTP | Pass | Screenshot |
|--------|------|------|------|------------|
| `date?` | Factual | **200** | **Pass** | `artifacts/design/final-after/ask-factual__1440x1000.png` |
| `Should I do this hackathon?` | Decision | **200** | **Pass** | `artifacts/design/final-after/ask-decision__1440x1000.png` |

Composer empty/rest state captured at all seven viewports as `ask__{viewport}.png`.

### Factual (`date?`)

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Answer rendered | Dates / deadline from evidence | Sep 13–15 2026; deadline Aug 15 2026; Confirmed | Pass |
| Confidence meta | Quiet meta, not dump | High confidence · Based on stored evidence | Pass |
| Raw snippet leak | None | No leak hints in harness scan | Pass |
| Input after success | Cleared or ready for next | Ready for next question | Pass |

### Decision (`Should I do this hackathon?`)

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Structured recommendation | Verdict + why + next step | STRONG YES; why bullets; next step (register by Aug 15) | Pass |
| Confidence | Visible | High confidence | Pass |
| No raw source dump | Prose + citations, not pipe/evidence blobs | Clean structured card | Pass |
| Thread order | Newest adjacent to composer | Decision above prior factual in thread | Pass |

## Composer chrome (regression)

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Placeholder | `Ask about this event…` | Present | Pass |
| No “Ask anything” heading | Absent | Absent | Pass |
| No chip row | Absent | Absent | Pass |
| Enter submits / Shift+Enter newline | Behavior preserved | Enter submitted both prompts | Pass |

## Console / network

- Product console errors: none (`final-after/console.json`)
- Failed non-`_next` requests during Ask: none
- Ask POSTs both returned 200

## Material mismatches

None. Optional polish (non-blocking):

| Area | Note | Severity |
|------|------|----------|
| Composer visual weight | Still reads as nested panel vs flat research thread (see `ASK_UX_GAP.md`) | Low |
| Source link color | Prefer blueprint ink over generic link blue if still present | Low |

## Related docs

- Runtime routing / synthesis: `ASK_RUNTIME_AUDIT.md`
- Presentation gaps: `ASK_UX_GAP.md`
- Visual shell: `VISUAL_QA.md`
