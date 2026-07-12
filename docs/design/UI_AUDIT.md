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
