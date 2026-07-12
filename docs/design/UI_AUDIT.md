# UI audit — rendered review experience (baseline)

Branch: `step-10-2-design-overhaul`  
Baselines: `artifacts/design/before/` at 390×844, 768×1024, 1440×1000  
Capture: Node Playwright (Python `playwright` module unavailable); `with_server.py --help` run first; server-already-running path used after Windows `npx` spawn failure via `with_server`.

## Figma MCP

Official Figma MCP: **not found**. Local design lab used instead.

## Highest-impact issues (12)

### 1. Queue card — raw / unparsed summary noise
- **Page/state:** Queue (mobile + desktop)
- **Problem:** Summary shows pipe-delimited directory scrapings instead of a concise human summary.
- **User impact:** Cannot scan why the event matters; trust collapses.
- **Severity:** Critical
- **Skill guidance:** Clean (reduce clutter); Editorial (readable body); Impeccable (hierarchy)
- **Proposed correction:** Cap summary to 2–3 lines of cleaned prose; move raw source snippets into evidence only.

### 2. Queue scan order is muddled
- **Page/state:** Queue
- **Problem:** Score + dual NEW/WEB pills + hero gradient compete before title/date/eligibility.
- **User impact:** Slow decisions; eye jumps to chrome instead of facts.
- **Severity:** High
- **Skill guidance:** Clean hierarchy; Editorial left-aligned document rhythm
- **Proposed correction:** Status → title → date/location/mode → summary → deadline/eligibility → top evidence → decision bar.

### 3. Decision controls cramped / partially clipped on mobile
- **Page/state:** Queue @ 390
- **Problem:** Large circular Reject/Save/Approve sit under “More details” with keyboard hints; thumb zone crowded; risk of clipping with long titles.
- **User impact:** Mis-taps; slower review on phone.
- **Severity:** High
- **Skill guidance:** A11y 44px+ targets; Clean restraint
- **Proposed correction:** Fixed bottom decision bar with 44px+ targets; keep card content above fold without overlapping nav.

### 4. Nested card-in-card + decorative hero
- **Page/state:** Queue card
- **Problem:** Soft glow hero + rounded mega-card + inner pills reads as generic SaaS, not an operations desk.
- **User impact:** Feels decorative; weak brand for a private review tool.
- **Severity:** Medium
- **Skill guidance:** Clean anti-decoration; product direction (no gradients/glass)
- **Proposed correction:** Flat elevated surface; thin borders; no hero glow; one status indicator.

### 5. Candidate detail not document-like
- **Page/state:** Candidate detail (when loaded)
- **Problem:** One large nested panel with section stacking; desktop wastes width; no primary column + facts rail.
- **User impact:** Harder investigation; evidence and Ask feel bolted on.
- **Severity:** High
- **Skill guidance:** Editorial document grids; Impeccable completeness
- **Proposed correction:** Primary reading column + secondary rail (facts/actions) ≥1024px; single column on mobile.

### 6. Evidence hierarchy not obvious
- **Page/state:** Candidate detail / Sources
- **Problem:** Authority shown as a number without strong type/label ordering; official vs directory not visually ranked enough.
- **User impact:** Users may open weak sources first.
- **Severity:** High
- **Skill guidance:** Editorial citations; Clean limited semantic color
- **Proposed correction:** Ordered list by authority; credibility labels (Official / Apply / Directory / Social / Article); quiet metadata.

### 7. Excessive pill badges
- **Page/state:** Queue + detail
- **Problem:** Status, source, themes, and sync badges all as pills.
- **User impact:** Visual noise; status loses meaning.
- **Severity:** Medium
- **Skill guidance:** Clean limited palette; no excessive pills (product brief)
- **Proposed correction:** One status indicator; themes as plain text chips or comma list; sync as inline notice.

### 8. Ask panel feels secondary / chip-driven
- **Page/state:** Candidate detail Ask
- **Problem:** Input buried in a nested panel; empty state and shortcuts underplay free-text.
- **User impact:** Users may not realize arbitrary questions work.
- **Severity:** Medium
- **Skill guidance:** Impeccable interaction clarity; Editorial investigation flow
- **Proposed correction:** Ask as an investigation section with prominent composer; chips as optional shortcuts only.

### 9. History / technical noise still competes
- **Page/state:** Candidate detail Activity
- **Problem:** Even collapsed, activity can sit equal with evidence; long histories not visually secondary.
- **User impact:** Investigation interrupted by audit noise.
- **Severity:** Medium
- **Skill guidance:** Clean de-emphasis; Editorial primary reading path
- **Proposed correction:** Activity below Ask; summary line default; technical disclosure tertiary.

### 10. Supporting lists (approved/rejected/saved) look like sparse admin tables
- **Page/state:** Approved / Rejected / Saved
- **Problem:** Low information density with weak hierarchy vs queue.
- **User impact:** Hard to recover context for restore/approve.
- **Severity:** Medium
- **Skill guidance:** Editorial list rhythm; Impeccable empty/edge cases
- **Proposed correction:** Compact rows: title, date, location, status, primary action — no nested cards.

### 11. Empty / error / loading states are generic centered cards
- **Page/state:** Empty queue, error, loading
- **Problem:** Floating dashed/error cards on grid; inconsistent with document workspace; Next.js overlay can obscure chrome.
- **User impact:** Breaks mental model; less reassuring recovery.
- **Severity:** Medium
- **Skill guidance:** Clean empty/loading/error design; a11y status roles
- **Proposed correction:** Left-aligned page-level notices inline with content column; skeletons that match review layout.

### 12. Desktop composition underuses width; mobile bottom nav competes with decisions
- **Page/state:** Queue @ 1440 vs 390
- **Problem:** Content column narrow; on mobile, bottom nav + decision circles fight for thumb space.
- **User impact:** Desktop feels sparse; mobile feels crowded.
- **Severity:** High
- **Skill guidance:** Editorial grid; a11y touch targets
- **Proposed correction:** Desktop: intentional max-widths + optional rail; mobile: sticky decision bar above nav with safe-area padding.

## Capture notes

- Fixed mock UUID detail sometimes returned “Candidate not found” after store churn; queue list screenshots remain authoritative for review chrome.
- `loading__390x844.png` captured; error/empty captured in follow-up script after route-handler fix.

---

## Failed redesign review

Branch: `step-10-2-design-overhaul` (post Phase 10.2 implementation, pre-corrective pass)  
Date: 2026-07-12  
Artifacts: `artifacts/design/failed-redesign-audit/`  
Viewports inspected: 390×844, 768×1024, 1440×1000, 1728×900  
Method: webapp-testing skill path (`with_server.py --help` — Python unavailable on host); Node Playwright capture scripts; code audit of production components. No production component edits in this step.

Skills consulted for this review (opened): Impeccable, Clean, Editorial, GSAP core/react/timeline/performance, webapp-testing.

### Layout measurements (queue)

| Viewport | Observed behavior |
|----------|-------------------|
| 390×844 | Single column; card ~full content width; bottom nav + Reject/Save/Approve + “More details” compete for thumb space |
| 768×1024 | Card still capped by `--content-queue: 27.5rem` (~440px); unused side canvas grows |
| 1440×1000 | Narrow centered review column inside `max-w-5xl` shell; large empty grid background left/right of ~440px card |
| 1728×900 | Same narrow card; unused canvas dominates; sidebar 14rem; primary workspace does not expand |

Hard caps in code: `--content-queue: 27.5rem`, `SwipeDeck`/`CandidateProgress` `max-w-[420px]`, shell `max-w-5xl`.

### Issue matrix

#### 1. Desktop wastes canvas; review trapped in narrow column
- **Page/state:** Queue @ 1440 / 1728
- **Current behavior:** Candidate card forced to ~420–440px while main canvas is 1000px+; empty drafting-grid background fills the rest.
- **User impact:** Slow scanning; product feels like a mobile mockup on a desktop monitor.
- **Severity:** Critical
- **Applicable skill guidance:** Editorial (structured grids, intentional width); Clean (hierarchy without empty decoration); Impeccable (consistency of workspace)
- **Intended correction:** Fluid workspace — nav ~220–250px, primary review ~720–900px, optional context rail ~260–320px; expand with viewport; no shrink-from-mobile-only layout.

#### 2. Queue card visually weak / too small
- **Page/state:** Queue at rest (all viewports; worst on desktop)
- **Current behavior:** Compact card, modest type, score badge competes; decision chrome dominates lower half.
- **User impact:** Candidate is not the hero of the review moment.
- **Severity:** High
- **Applicable skill guidance:** Editorial (title hierarchy); Clean (reduce competing chrome); Impeccable (interaction states without noise)
- **Intended correction:** Larger primary content area; stronger title/summary hierarchy; remove permanent decision button row.

#### 3. Permanent instructional clutter
- **Page/state:** Queue
- **Current behavior:** Simultaneously shows: “One candidate at a time…”, desktop “Keyboard: Left reject…”, progress “Swipe or use buttons”, footer “← reject · → approve · S save · Enter details”, and button titles with shortcut hints.
- **User impact:** Cognitive load; instructions crowd the decision surface.
- **Severity:** High
- **Applicable skill guidance:** Clean (remove clutter); Impeccable (clear but not redundant writing)
- **Intended correction:** Keep shortcuts functional; move help to `?` / tooltip / settings disclosure only.

#### 4. Descriptions raw, repetitive, or mid-truncated
- **Page/state:** Queue summary; detail description
- **Current behavior:** `summarize()` only swaps pipes and hard-slices at 220 chars (`CandidateCard.tsx`); no boilerplate strip, sentence-aware clamp, or grounded-summary preference.
- **User impact:** Unreadable scrapings; truncated mid-word; weak trust.
- **Severity:** Critical
- **Applicable skill guidance:** Editorial (readable prose); Clean (signal over scrapings)
- **Intended correction:** Display-content normalization layer (no raw evidence mutation); sentence-aware queue summary (2–4 sentences); readable detail paragraphs.

#### 5. Visible Approve / Reject / Save button row on queue
- **Page/state:** Queue card
- **Current behavior:** Full `CandidateActions` decision bar always rendered.
- **User impact:** Feels like a form, not a review gesture; fights mobile thumb space.
- **Severity:** High
- **Applicable skill guidance:** Clean restraint; GSAP (gesture motion with reduced-motion); a11y (non-swipe routes required)
- **Intended correction:** Swipe-first + keyboard; subtle accessible menu/SR controls; no large visible decision row.

#### 6. Detail actions not state-aware
- **Page/state:** Candidate detail (APPROVED / REJECTED / SAVED_FOR_LATER)
- **Current behavior:** Mobile bar + desktop Actions rail always show Approve, Save, Reject; only Restore is gated (`status !== "NEW"`). No Unsave label.
- **User impact:** No-op / confusing actions (Approve on approved, Save on saved, Reject on rejected).
- **Severity:** Critical
- **Applicable skill guidance:** Impeccable (explicit states); Clean (no ambiguous actions)
- **Intended correction:** Central `getCandidateActions(candidate)` used everywhere; hide current-state no-ops; Unsave when saved.

#### 7. Ask looks like a generic chatbot form
- **Page/state:** Candidate detail Ask
- **Current behavior:** Heading “Ask anything about this event”, helper “suggestions are shortcuts…”, up to 6 chips, visible “Ask” button, empty-state tutorial copy.
- **User impact:** Feels bolted-on; chips imply allowlist; free-text undervalued.
- **Severity:** High
- **Applicable skill guidance:** Clean (one composer); Editorial (investigation document field)
- **Intended correction:** Single quiet composer + research thread; Enter submit / Shift+Enter newline; no chips/heading/explanatory copy.

#### 8. Ask does not reason on decision questions
- **Page/state:** Ask — e.g. “Should I do this hackathon?”
- **Current behavior:** Deterministic regex templates + optional live-search snippet dump; no LLM path; decision questions fall through to low-confidence concatenated stored text.
- **User impact:** No recommendation, trade-offs, or next step; pasted fragments.
- **Severity:** Critical
- **Applicable skill guidance:** Impeccable completeness of investigation; product PRD Ask intent
- **Intended correction:** Classify factual vs decision; LLM-first structured decision response with reasons/concerns/missing/next step/citations; preserve rate limits and no status/Sheets mutation.

#### 9. Generic dark dashboard aesthetic
- **Page/state:** Global shell, queue, detail, history
- **Current behavior:** Near-black SaaS neutrals (`#0a0a0c` / `#16161a`), soft cards, generic accents; faint slate grid; not a distinctive blueprint system.
- **User impact:** Feels vibecoded; weak product identity for a private ops tool.
- **Severity:** High
- **Applicable skill guidance:** Clean (limited palette, restraint); Editorial (document feel); Impeccable (token consistency) — adapted toward blueprint tokens, not warm cream/orange brand defaults where they conflict with the blueprint brief
- **Intended correction:** Compare Restrained vs Expressive Blueprint variants in design lab; implement selected token system across surfaces.

#### 10. Large “More details” button competes with decision flow
- **Page/state:** Queue card
- **Current behavior:** Full-width bordered “More details” above decision bar.
- **User impact:** Extra chrome; accidental opens; weak subtle affordance.
- **Severity:** Medium
- **Applicable skill guidance:** Clean hierarchy; Editorial investigation entry
- **Intended correction:** Subtle handle/chevron; tap body / Enter; mobile bottom sheet; desktop expanded workspace.

#### 11. Score as unexplained product signal
- **Page/state:** Queue card + detail Facts rail
- **Current behavior:** Large “86 / score” badge with color bands; no plain-language meaning.
- **User impact:** Users may treat discovery score as quality/verdict.
- **Severity:** Medium
- **Applicable skill guidance:** Clean (quiet secondary data); Impeccable (unambiguous labels)
- **Intended correction:** Rename to “Discovery relevance” or demote/remove from primary UI; keep quiet + accessible explanation.

#### 12. Facts/actions rail tiny labels + stacked buttons
- **Page/state:** Candidate detail desktop aside
- **Current behavior:** All-caps micro labels; score block; full-width Approve/Save/Reject stack duplicates mobile actions.
- **User impact:** Secondary rail visually competes with investigation document.
- **Severity:** High
- **Applicable skill guidance:** Editorial document + rail; Clean de-emphasis
- **Intended correction:** Quiet facts; compact contextual actions via policy; evidence priority ordered.

#### 13. Save model clarity (audit finding)
- **Page/state:** Data model / Saved page
- **Current behavior:** Save is status `SAVED_FOR_LATER` plus `saved_at` timestamp — not an independent `is_saved` flag. UI does not expose Unsave; Restore returns to `NEW`.
- **User impact:** Spec/UI mismatch risk if treated as a boolean overlay.
- **Severity:** Medium (correctness for Step 7)
- **Applicable skill guidance:** Impeccable completeness; functional correctness first
- **Intended correction:** Policy treats SAVED_FOR_LATER as saved state; Unsave maps to existing restore/API behavior without inventing a new flag.

#### 14. No owner preference storage for personalization
- **Page/state:** Settings / Ask
- **Current behavior:** Settings is diagnostics only. `DiscoveryPreferences` exist on agent runs only — not loaded into Ask.
- **User impact:** Decision answers cannot personalize; must state generic recommendation when prefs absent.
- **Severity:** Medium (Step 11 — do not block)
- **Applicable skill guidance:** Functional correctness; no migration without approval
- **Intended correction:** Decision path works without prefs; propose lightweight settings schema later; no migration this phase.

### Console / requests (capture session)
- Login + queue/history routes returned 200 with mock candidates.
- Occasional `net::ERR_ABORTED` during rapid viewport navigation coincided with Next Fast Refresh — not a product regression.
- No unexpected auth/Sheets/discovery mutations during read-only audit.

### Acceptance implication
The Phase 10.2 redesign fails acceptance criteria for fluid layout, instructional clutter, swipe-first queue, state-aware actions, description quality, Ask decision reasoning, and blueprint visual direction. Corrective Steps 2–17 address these without weakening auth, rate limits, Sheets sync, evidence grounding, or persistence.

---

## Second corrective review

Branch: `step-10-2-design-overhaul`  
Date: 2026-07-12  
Artifacts: `artifacts/design/corrective-before/` (50 PNGs + `metrics.json`)  
Viewports: 390�844, 430�932, 768�1024, 1024�900, 1440�1000, 1728�900, 1920�1080  
Surfaces: queue, approved, rejected, saved, settings, candidate-detail, ask-section, ask-response@1440  
Method: Node Playwright (server restarted with mock auth after stale `.next` 404s). No production component edits.

`unusedPct = (mainWidth - cardWidth) / clientWidth * 100`

### Layout measurements (queue)

| Viewport | clientWidth | cardWidth | mainWidth | sidebarWidth | unusedPct | overflowX |
|----------|------------:|----------:|----------:|-------------:|----------:|:---------:|
| 390�844 | 390 | 347 | 390 | 0 | 11.0 | no |
| 430�932 | 430 | 386 | 430 | 0 | 10.2 | no |
| 768�1024 | 768 | 621 | 768 | 0 | 19.1 | no |
| 1024�900 | 1024 | 621 | 817 | 207 | 19.1 | no |
| 1440�1000 | 1440 | 621 | 1233 | 207 | 42.5 | no |
| 1728�900 | 1728 | 621 | 1521 | 207 | 52.1 | no |
| 1920�1080 | 1920 | 621 | 1713 | 207 | 56.9 | no |

Notes: `--content-queue: 40rem` (~640px) caps the review card from tablet up. Desktop sidebar measures ~207px. No horizontal overflow on any captured queue viewport.

### Key desktop numbers

| Metric | 1440�1000 | 1920�1080 |
|--------|----------:|----------:|
| clientWidth | 1440 | 1920 |
| cardWidth | 621 | 621 |
| mainWidth | 1233 | 1713 |
| sidebarWidth | 207 | 207 |
| unusedPct | 42.5% | 56.9% |
| overflowX | false | false |

### Issue matrix

#### 1. Content / card width � review card hard-capped while main expands
- **Page/state:** Queue @ =768 (worst @ 1440 / 1920)
- **Expected:** Fluid primary review column (~720�900px+) that grows with the workspace.
- **Actual:** Card locked at **621px** (`--content-queue: 40rem`); main grows to 1233�1713px.
- **Severity:** Critical
- **Fix:** Raise/remove hard cap; size card as a fluid fraction of main (with sensible max), not a phone-width column on desktop.

#### 2. Unused viewport % � empty blueprint canvas dominates desktop
- **Page/state:** Queue @ 1440 / 1728 / 1920
- **Expected:** Unused side canvas < ~20�25% of client for an ops review desk.
- **Actual:** **42.5% @1440**, **52.1% @1728**, **56.9% @1920** of client width is main-minus-card emptiness.
- **Severity:** Critical
- **Fix:** Expand card + optional context rail; stop centering a mobile card in a wide drafting grid.

#### 3. Nav width / chrome crowding
- **Page/state:** Desktop shell sidebar; mobile bottom nav
- **Expected:** Stable ~220�250px nav; logout/sheet controls fully visible; tablet gets a deliberate layout.
- **Actual:** Sidebar **~207px**; Open Sheet / Logout / avatar crowd the footer (Logout can read clipped). Tablet **768** still uses bottom nav + 621px card (19.1% unused) � neither phone-tight nor desktop workspace.
- **Severity:** High
- **Fix:** Widen nav slightly; stack footer controls with safe padding; introduce tablet breakpoint (side nav or denser queue) instead of stretched-phone chrome.

#### 4. Mobile overflow / composition
- **Page/state:** Queue @ 390 / 430
- **Expected:** Full-bleed readable card; no horizontal scroll; decision affordances clear.
- **Actual:** **No overflowX**. Card ~347�386px (healthy). Large empty grid below card above bottom nav; `�` menu is the only visible decision chrome (improvement vs permanent button row).
- **Severity:** Medium (empty vertical canvas / weak mobile density; overflow pass)
- **Fix:** Tighten vertical rhythm; keep swipe + `�`; ensure 44px targets inside menu.

#### 5. Tablet composition (768 / 1024)
- **Page/state:** Queue @ 768�1024, 1024�900
- **Expected:** Transitional workspace � wider card, optional side nav, less dead grid.
- **Actual:** Card stuck at **621px**; 768 keeps bottom nav; 1024 adds 207px side nav but card does not grow (unusedPct still 19.1%).
- **Severity:** High
- **Fix:** Break `40rem` earlier; at =1024 grow card with main; avoid phone bottom nav once side nav appears.

#### 6. Desktop composition (detail / settings)
- **Page/state:** Candidate detail, settings @ 1440+
- **Expected:** Document column + facts/actions rail filling the workspace intentionally.
- **Actual:** Detail document + Facts/Actions rail present (good), but the whole block sits in a max-width island with large left/right gutters on the blueprint grid. Settings cards similarly narrow-centered. Header actions float far from the narrow review stack on queue.
- **Severity:** High
- **Fix:** Fluid shell max-width; align header/progress/card to one expanding column; let settings use a readable ~720�960px column without huge side voids.

#### 7. Blueprint authenticity & typography
- **Page/state:** Global
- **Expected:** Cohesive blueprint token system (grid, ink, display type) distinct from generic dark SaaS.
- **Actual:** Grid background + navy ink read blueprint-adjacent and better than prior black SaaS, but **body font is still `ui-sans-serif, system-ui, sans-serif`** (system stack). `--font-display` empty in measured tokens. Title serif on cards helps hierarchy but feels bolted on rather than tokenized.
- **Severity:** Medium
- **Fix:** Wire display/body font tokens; tighten blueprint line/ink tokens so type + grid feel designed, not default + overlay.

#### 8. Ask response problems (visible UI)
- **Page/state:** Candidate detail Ask @ 1440 (`ask-response__1440x1000.png`)
- **Expected:** One clear decision answer; structured why/concerns/missing/next; no raw dumps.
- **Actual:** Decision path **works** (structured Why / Concerns / Missing / Next step; placeholder `Ask about this event�`). **No raw snippet / URL dump leakage** observed. Issues: **duplicate stacked answers** for the same question (e.g. DECISION � MEDIUM and DECISION � HIGH both visible); next-step copy can feel clipped/abrupt in thread text; Ask sits inside nested cards rather than a quiet investigation strip.
- **Severity:** High (duplication / presentation); leakage = pass
- **Fix:** Dedupe thread (replace-in-place or collapse prior); sentence-complete next steps; reduce card nesting around Ask.

### Console / requests
- Capture session: no console errors recorded; no unexpected =400 API failures in the metrics log.
- Dev server required `.next` clear + restart after login/API 404s from a corrupted Fast Refresh state (harness only).

### Acceptance snapshot
| Check | Result |
|-------|--------|
| Horizontal overflow (queue matrix) | Pass |
| Raw Ask snippet leakage | Pass |
| Ask decision structure visible | Pass (with duplicate-answer noise) |
| Fluid desktop card width | Fail |
| Unused viewport budget @1440/1920 | Fail |
| Tablet transitional layout | Fail |
| Blueprint type tokens | Fail / partial |
| Nav footer crowding | Fail / partial |
