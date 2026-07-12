# Blueprint authenticity gap analysis

**Status:** Read-only analysis (no production CSS implemented this wave)  
**Reference:** `artifacts/design/blueprint-reference.png` (F-16-style drafting sheet — deep cobalt paper, major/minor grid, double-line frame, corner registration, dimension ticks, warm off-white ink)  
**Compared against:** `src/app/globals.css`, shell (`AppShell`, `Navigation`), cards/panels (`.hf-card`, `.hf-panel`, `CandidateCard`, settings/history surfaces), Ask composer, `docs/design/DESIGN_REVIEW.md`  
**Prior selection note:** Step 13–14 chose *Restrained Blueprint* over *Expressive Blueprint* for readability. That choice improved navy/paper contrast but did **not** deliver authentic drafting-sheet language — it still reads as a dark SaaS desk with a faint equal grid.

---

## Verdict

Current production is a **restrained dark-blue product UI** with cyan-tinted hairlines. It is not yet an authentic drafting blueprint. Removing the brand name would still leave a familiar dashboard: rounded elevated cards, soft shadows, single-pixel slate borders, glass mobile chrome, and a uniform low-contrast grid.

**Recommended lean for Step 3:** **Drafting Sheet** (Variant A) — authenticity-first primitives, restrained intensity so queue/detail reading stays primary. Use Modern Blueprint (Variant B) only as a fallback if Drafting Sheet fails contrast or scan-speed QA.

---

## Eight authenticity gaps

1. **Canvas is flat SaaS navy, not cobalt drafting paper** — `#0b1524` / `#101c2e` / `#142338` are clean digital flats; the reference uses saturated cobalt with grain, fold, and ink bleed. No paper texture token; surfaces feel like elevated panels, not sheet stock.

2. **Grid is single-tier and nearly invisible** — `.grid-background` is one 32×32 cyan grid at ~3.5% opacity. Authentic sheets need **major + minor** lines (thicker/more opaque majors, finer minors), with grid **behind content only** and never crossing titles or body.

3. **No double-line sheet frame or title-block language** — Shell is flex + sidebar + padded main. Reference sheets sit inside a thick/thin double border with edge ticks. Sidebar/`hf-shell-main` have no outer drafting frame, no title block, no scale/meta strip.

4. **Borders are cool slate hairlines, not warm ink construction lines** — `--border: #2a3f56` and cyan-mix rims read as UI chrome. Reference ink is warm off-white / light cream on cobalt; construction lines are thin, desaturated paper-ink, not gray-blue SaaS dividers.

5. **Cards are soft SaaS rectangles** — `.hf-card` / queue article use `border-radius: 0.75–1rem`, `box-shadow: var(--shadow-soft|card)`, single 1px border. Authentic panels are near-square frames (0–4px radius), **double-line** borders, **corner registration** (L-marks / cross ticks), **no drop shadow** (ink sits on paper).

6. **Missing drafting primitives entirely** — No corner registration marks, dimension ticks, dashed “hidden” secondary rules, leader-dot meta rows, or scale-bar metaphors. Semantic actions exist (approve/reject/save) but are not expressed in construction-line weight hierarchy.

7. **Chrome still leaks generic dark SaaS** — Mobile nav `backdrop-blur`; filled primary button; `rounded-full` progress/pills; ad-hoc `sky-*` / `amber-*` Tailwind; soft focus glow on `.hf-input`. These fight drafting identity even when tokens are navy.

8. **Docs and production diverge** — `VISUAL_SYSTEM.md` still documents near-black editorial neutrals (`#0a0a0c`). Production tokens are restrained blueprint navy, but neither doc set specifies authentic sheet primitives (major/minor grid, double frame, registration, tick marks). Step 3 needs one canonical authenticity spec.

---

## Variant A — Drafting Sheet (recommended lean)

**Intent:** Make the review workspace read as a **working drawing on cobalt paper** at first glance, while keeping body/meta contrast and decision clarity for long sessions.

### Token map (propose; do not ship until variant lab QA)

| Token | Proposed | Role |
|-------|----------|------|
| `--background` | `#0a1f3d` → `#0c2748` range (pick one after capture) | Saturated cobalt paper canvas |
| `--surface` | ~4–6% lift from canvas | Sidebar / title-block field |
| `--card` / `--panel` | Same family as surface, slight lift | Sheet panels (not floating cards) |
| `--inset` | Slightly deeper than canvas | Fields, nested lists |
| `--foreground` | `#f0ebe2` / `#ebe6da` | Warm off-white ink |
| `--muted` | `#9eb0c4` desaturated blue-gray | Secondary labels (not bright cyan) |
| `--ink-line` | `color-mix(in oklab, var(--foreground) 55%, transparent)` | Primary construction / double-border ink |
| `--ink-line-strong` | `color-mix(..., 78%)` | Outer frame, active registration |
| `--ink-line-faint` | `color-mix(..., 22%)` | Minor grid, dashed secondary |
| `--grid-major` | warm ink @ ~10–14% | Major squares |
| `--grid-minor` | warm ink @ ~4–6% | Subdivision |
| `--grid-major-size` | `64px` or `80px` | Major pitch |
| `--grid-minor-size` | `8px` or `10px` | Minor pitch (8–10 subdivisions) |
| `--accent-focus` | drafting cyan `#6ec4d8` restrained | Focus / construction highlight only |
| `--accent-approve` / `reject` / `warn` / `save` | Keep current family; retune borders to ink weight | Semantics stay color; chrome stays line |
| `--radius-sheet` | `0`–`2px` | Panels/frames |
| `--radius-control` | `2px`–`4px` | Buttons/inputs (not xl pills) |
| `--shadow-card` / `--shadow-soft` | **none** on sheets (or 0) | No floating elevation |
| `--frame-gap` | `3px`–`4px` | Gap between outer/inner double line |

### Primitives to create

| Primitive | Spec |
|-----------|------|
| `.hf-sheet-grid` | Replace/upgrade `.grid-background`: layered major + minor `repeating-linear-gradient`; optional ultra-subtle noise via CSS only (no animated grid); hide or weaken minors on small screens if contrast suffers |
| `.hf-sheet-frame` | Double-line border (outer thicker, inner thinner) using `--ink-line*`; applied to main review column and/or full shell content well |
| `.hf-corner-marks` | Four corner registration L-marks or cross ticks via `::before`/`::after` + background corners; never overlap text |
| `.hf-dim-ticks` | Optional edge dimension ticks on queue card / detail sheet (CSS border-image or absolutely positioned 45° ticks at mid-edges) |
| `.hf-panel` / `.hf-card` retune | Squareish, double hairline, no shadow, registration corners; background = paper panel, not elevated SaaS |
| `.hf-title-block` | Compact mono meta strip (page name, count, “SCALE”/status) — sidebar brand or queue header |
| `.hf-rule-dashed` | Dashed secondary separators for collapsed/secondary sections |
| `.hf-meta-leader` | Optional mono label····value pattern for metadata rows |
| Controls | Outline-first buttons; filled only for primary Approve if needed; focus = hard cyan drafting ring, not soft glow blob |

### Usability guardrails (Drafting Sheet)

- Body text contrast ≥ WCAG AA on cobalt; grid opacity capped so titles remain dominant.
- Grid **background only** — never inside text blocks.
- Registration/ticks decorative; pointer-events none; ignore under reduced-motion (static is fine).
- No all-mono UI; mono for dates, IDs, sources, title-block only.
- No neon glow, glass stacks, or purple.

---

## Variant B — Modern Blueprint (fallback)

**Intent:** Keep the current **restrained navy product shell** (proven for long review) but add **lightweight drafting cues** so identity improves without a full sheet metaphor.

### Token map

| Token | Proposed | Role |
|-------|----------|------|
| Surfaces | Keep near current `#0b1524` / `#101c2e` / `#142338` | Continuity with Step 14 |
| `--foreground` | Keep `#ebe8e0` | Warm paper text |
| Borders | Shift `--border` toward ink-mix with foreground (less slate) | Slight authenticity bump |
| `--grid-major` / `--grid-minor` | Add two-tier grid @ lower opacity than Variant A (major ~7%, minor ~3%) | Readable cue without sheet drama |
| Radius | Reduce card radius to `--radius-md` (8px); kill 16px card soft-shadow | Less SaaS |
| Shadows | Soft shadow only on **active** queue card, or remove entirely | Restraint |
| Accents | Unchanged semantic set | Decision clarity |

### Primitives to create

| Primitive | Spec |
|-----------|------|
| Two-tier `.grid-background` | Same API as A, quieter opacities |
| `.hf-panel` single-line + corner ticks | One ink border + corner marks; no full double frame on every card |
| Optional `.hf-sheet-frame` | Only around queue deck / detail document, not whole app |
| Kill blur on mobile nav | Solid cobalt bar |
| Retune `.hf-card` | Flatter, tighter radius, quieter border |

### Trade-off

Faster to implement and safer for scan speed; may still fail the “authentic blueprint” glance test vs the reference image.

---

## What currently fails (detail map)

| Area | Current | Authentic expectation |
|------|---------|------------------------|
| `globals.css` surfaces | Flat navy stack + soft shadows | Cobalt paper; ink on sheet; no float |
| `.grid-background` | Equal 32px @ 3.5% cyan | Major/minor warm-ink grid |
| `.hf-card` / `.hf-panel` | Rounded + single border + shadow | Double-line, square, corner marks |
| `.hf-btn-primary` | Filled cyan pill-ish | Outline / weight hierarchy |
| `.hf-input:focus` | Soft glow ring | Hard drafting focus line |
| Shell | Opaque sidebar, no frame | Title block + content sheet well |
| Mobile nav | `backdrop-blur` glass | Opaque paper/cobalt bar |
| Cards/components | Tailwind `sky-*`, pills, `rounded-full` | Tokenized ink + restrained chips |
| Docs | `VISUAL_SYSTEM` stale; `DESIGN_REVIEW` stopped at “restrained navy” | Authenticity criteria + primitives |

---

## Step 3 — files to touch (implementation wave; not this wave)

### Must change

1. `src/app/globals.css` — tokens, grid, sheet frame, corner marks, panel/card/button/input retune, kill soft card shadows by default  
2. `src/components/shell/AppShell.tsx` — optional content sheet well / frame wrapper  
3. `src/components/shell/Navigation.tsx` — title-block brand, active nav as ink weight (not white/8 fill), remove blur, replace ad-hoc sky rings with `hf-focus`  
4. `src/components/candidates/CandidateCard.tsx` — use `.hf-card` / sheet primitives; drop shadow class; tighter radius  
5. `src/components/candidates/CandidateDetailView.tsx` — document panel as sheet; Ask composer borders; amber/sky ad-hoc → tokens  
6. `src/components/candidates/CandidateHero.tsx` — title-block / status rule language  
7. `src/app/(workspace)/settings/page.tsx` — `rounded-2xl` card sections → sheet panels  
8. `src/components/history/HistoryView.tsx` — list rows as drafting panels, not soft SaaS cards  

### Likely follow-ons

9. `src/components/candidates/CandidateActions.tsx` / decision bar — outline construction weights  
10. `src/components/candidates/CandidateProgress.tsx` — replace `rounded-full` sky bar with rectangular ink rule  
11. `src/components/candidates/CandidateScore.tsx` — tick-framed score cell, not soft rounded badge  
12. `src/components/sheets/SheetSyncBadge.tsx` / tags — quieter chips  
13. `src/app/login/page.tsx` — login as sheet frame for brand consistency  
14. `src/app/layout.tsx` — class rename if `.grid-background` → `.hf-sheet-grid`  
15. `docs/design/DESIGN_REVIEW.md` + `docs/design/VISUAL_SYSTEM.md` — record selected variant + token map  
16. Design lab: new mockups `docs/design/mockups/blueprint-drafting-sheet.html` and `blueprint-modern.html` + captures under `artifacts/design/` at 390 / 768 / 1440  

### Do not touch this wave (already done / out of scope)

- Collectors, DB, sheets sync logic  
- Production theme shipping before variant comparison captures  

---

## Acceptance criteria (Step 3 done when)

1. **Glance test:** At 1440 and 390, a reviewer familiar with the reference says the UI reads as **drafting blueprint**, not generic dark SaaS (navy alone is insufficient).  
2. **Grid:** Visible major/minor drafting grid on page background only; does not reduce body/title contrast below AA; no animated grid.  
3. **Frame:** Primary review surfaces (queue card and/or detail document) use double-line or equivalent sheet framing with corner registration; no soft drop-shadow stack.  
4. **Ink:** Primary borders/text use warm off-white ink family on cobalt; structural lines are construction-like, not slate chrome.  
5. **Primitives shipped:** At least `.hf-sheet-grid`, sheet frame, corner marks, and retuned `.hf-panel`/`.hf-card` exist as shared CSS — not one-off Tailwind per page.  
6. **Semantics preserved:** Approve / Reject / Save / Warn remain clearly distinguishable; Approve stays the dominant decision.  
7. **A11y:** `:focus-visible` ≥ 2px drafting cyan; touch targets ≥ 44px; `prefers-reduced-motion` respected; no text crossed by decorative lines.  
8. **Chrome cleanup:** No `backdrop-blur` primary nav; no purple/glow; pills minimized; ad-hoc `sky-*` on shell/cards replaced by tokens.  
9. **Docs:** `DESIGN_REVIEW.md` updated with Drafting Sheet vs Modern comparison + selection; `VISUAL_SYSTEM.md` aligned to production tokens.  
10. **QA captures:** Both variants (or final + rejected) captured at 390×844, 768×1024, 1440×1000; paths listed in design review.

---

## Recommended variant lean

**Lean Drafting Sheet (Variant A)** for Step 3 implementation after a short lab comparison.

Rationale: the authenticity failure is structural (frame, grid hierarchy, ink, registration, anti-shadow), not merely “needs more cyan.” Prior *Expressive Blueprint* only raised cyan/grid intensity on the same SaaS card model — that path already lost on readability without gaining true sheet language. Drafting Sheet changes the **primitives**; Modern Blueprint only softens the gap.

If lab captures show Drafting Sheet harming queue scan speed or daylight contrast, fall back to Modern Blueprint but still require: two-tier grid, corner marks on primary surfaces, no blur nav, no card drop shadows.

---

## Reference & artifacts

| Path | Use |
|------|-----|
| `artifacts/design/blueprint-reference.png` | Authenticity north star (copied this wave) |
| `docs/design/mockups/blueprint-restrained.html` | Prior Step 13 A (insufficient authenticity) |
| `docs/design/mockups/blueprint-expressive.html` | Prior Step 13 B (cyan louder, still SaaS) |
| `artifacts/design/after/*` | Current production visual baseline |

---

## Out of scope this wave

- No production CSS edits  
- No commits  
- No deployments / migrations  
