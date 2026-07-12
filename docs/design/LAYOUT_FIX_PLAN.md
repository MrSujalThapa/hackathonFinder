# Layout Fix Plan — Step 2 (Fluid Review Workspace)

Status: **proposal only** (read-only analysis). Do not implement from this doc until Step 2 execution is requested.

Acceptance targets for this step:

| Viewport | Target |
| --- | --- |
| ≥1440 CSS px | Review **card ≥ 600px** wide (prefer primary column **720–900px**) |
| Desktop sidebar | **210–240px** |
| Mobile (&lt; lg) | Card / deck **full width** of content column (minus shell padding only) |

Product reference (queue UX): nav ~220–250px, primary ~720–900px, optional rail ~260–320px; no mobile-sized card floating in a wide empty canvas.

---

## 1. Why desktop still wastes space

The queue card stays narrow because **four independent max-width caps** stack, and the deck is **horizontally centered** inside a wider (still capped) workspace. Header/progress can partially escape one cap via a container query, but **SwipeDeck + CandidateCard never grow past `--content-queue` (40rem / 640px)**.

### Constraint chain (outside → in)

```text
viewport
  └─ AppShell flex row
       ├─ DesktopSidebar  w-[var(--sidebar-width)]     ← 14.5rem (232px)
       └─ flex-1 column
            └─ .hf-shell-main  max-width: --shell-max   ← 90rem (1440px)
                 + mx-auto + px-4 / sm:px-6
                 + container-type: inline-size (name: review)
                 └─ .hf-review-workspace  max-width: --content-queue-max  ← 56rem (896px)
                      └─ QueueReview inner  max-w-[--content-queue]      ← 40rem (640px)
                           + @[900px]:max-w-none  (lifts header column only)
                           └─ CandidateProgress  max-w-[--content-queue] ← 640px again
                           └─ SwipeDeck  mx-auto max-w-[--content-queue] ← 640px + centered
                                └─ CandidateCard  max-w-[--content-queue] ← 640px again
```

At **1440×1000** (lg+):

| Layer | Intended by tokens | Actual usable width |
| --- | ---: | ---: |
| Viewport | 1440 | 1440 |
| Minus sidebar | 1440 − 232 | **1208** |
| `.hf-shell-main` | min(1440, 1208) | **1208** |
| Minus `lg` padding (`sm:px-6` → 1.5rem×2) | 1208 − 48 | **1160** |
| `.hf-review-workspace` | min(896, 1160) | **896** |
| Deck / card (`--content-queue`) | 640 | **640** |
| Unused horizontal canvas | — | **~520px** (1160 − 640) |

At **1728×900**:

| Layer | Actual |
| --- | ---: |
| flex-1 after sidebar | 1496 |
| `.hf-shell-main` capped + `mx-auto` | **1440** (≈28px gutters in flex-1) |
| Content after padding | **1392** |
| Workspace / card | **896 / 640** |
| Unused | **~752px** beside the card |

**Verdict:** Desktop does not fail the absolute “≥600px card” floor (640 ≥ 600), but it **fails the fluid-layout intent**: primary stays phone-deck-sized while ~500–750px of canvas is empty. The visual read is “narrow card floating in a wide shell.”

---

## 2. Inventory — every `max-w` / `width` / `mx-auto` / `items-center` that constrains the queue

### Tokens (`src/app/globals.css`)

| Token | Current | px (@16) | Role |
| --- | --- | ---: | --- |
| `--content-queue` | `40rem` | **640** | Hard card/deck/progress/header cap |
| `--content-queue-max` | `56rem` | **896** | `.hf-review-workspace` cap |
| `--content-detail` | `48rem` | 768 | Detail page (not queue) |
| `--content-rail` | `17.5rem` | 280 | Detail rail |
| `--sidebar-width` | `14.5rem` | **232** | Desktop nav (already in 210–240) |
| `--shell-max` | `90rem` | **1440** | Main column ceiling |
| `--nav-mobile-height` | `4.25rem` | 68 | Mobile bottom nav reserve |

### CSS classes (`globals.css`)

| Selector | Constraint |
| --- | --- |
| `.hf-shell-main` | `max-width: var(--shell-max)`; `container-type: inline-size` |
| `.hf-review-workspace` | `width: 100%`; `max-width: var(--content-queue-max)` |
| `@container review (min-width: 56rem) .hf-review-workspace` | `max-width: min(56rem, 100%)` — **redundant** with the token (still 896px); does not grow the card |

### `AppShell.tsx`

| Class | Effect |
| --- | --- |
| `flex min-h-dvh w-full` | Full viewport row |
| `min-w-0 flex-1` | Main column takes remainder after sidebar |
| `hf-shell-main mx-auto w-full … px-4 sm:px-6` | **Centers** main column when flex-1 &gt; `--shell-max`; horizontal padding reduces content width |

### `Navigation.tsx`

| Class | Effect |
| --- | --- |
| Desktop `w-[var(--sidebar-width)] shrink-0` | Fixed **232px** sidebar |
| Mobile `mx-auto … max-w-lg` | Caps **bottom nav** row only (not the card) |
| Mobile item `items-center` | Icon/label centering; not a width cap |

### `QueueReview.tsx`

| Class | Effect |
| --- | --- |
| `hf-review-workspace` | Caps section at **896px** (left-aligned in shell) |
| Inner `max-w-[var(--content-queue)]` | Caps at **640px** |
| `@[900px]:max-w-none` | Removes 640 cap when shell container ≥900px — **header/filter only**; deck still capped below |
| Actions `items-center` | Flex alignment only |

### `SwipeDeck.tsx`

| Class | Effect |
| --- | --- |
| `relative mx-auto w-full max-w-[var(--content-queue)]` | **Primary card width lock (640px) + horizontal centering** — top cause of “floating” look |

### `CandidateCard.tsx`

| Class | Effect |
| --- | --- |
| `w-full max-w-[var(--content-queue)]` | **Second 640px lock** (redundant with SwipeDeck) |
| Inner `items-center` (score / detail affordance) | Not a column width constraint |

### `CandidateProgress.tsx`

| Class | Effect |
| --- | --- |
| `mb-4 w-full max-w-[var(--content-queue)]` | Progress bar stuck at **640px** even when header expands via CQ |

### `QueueCardPreview.tsx` (design lab / preview — not production queue, but same smell)

| Class | Effect |
| --- | --- |
| `items-center` on section | Centers preview column |
| `max-w-[440px]` | Hard **440px** preview (older mobile-card target) |
| Inner `justify-center` | Centers card |

### Related (not queue deck, noted for consistency)

| File | Constraint |
| --- | --- |
| `PageHeader` | `description` `max-w-xl` only — fine |
| `CandidateDetailView` | `max-w-[calc(var(--content-detail)+var(--content-rail)+2rem)]` + `xl:grid-cols-[…]` — detail Step, not queue |

---

## 3. Intended vs actual widths (from CSS tokens)

Product / audit intent (UI_AUDIT + queue UX rules):

| Region | Intended | Current token / class | Gap |
| --- | --- | --- | --- |
| Sidebar | 220–250px (this step: **210–240**) | `--sidebar-width: 14.5rem` → **232px** | **OK** (keep or nudge to 14rem / 224px) |
| Primary review | **720–900px** fluid | Card locked at **640px** (`40rem`) | **−80 to −260px** vs preferred band |
| Workspace envelope | Fill primary, not phone column | `.hf-review-workspace` **896px** | Envelope wider than card but still leaves shell empty; card does not use envelope |
| Shell | Expand with viewport | `--shell-max: 90rem` + `mx-auto` | Mild ultra-wide gutters; **not** the main narrow-card bug |
| Mobile | Full content width | Nested max-w still apply but equal parent until &gt;640 | OK under ~640; tablet (768) still capped at 640 inside padded shell |

### Computed scenarios

**A. 390 mobile (no sidebar)**

- Shell content ≈ 390 − 32 (`px-4`) = **358px**
- All max-w ≥ 640 → card = **~358px** (full column) ✅

**B. 768 tablet (no sidebar until lg)**

- Shell content ≈ 768 − 48 = **720px**
- Card max = **640** → **80px** unused inside shell; not “full width” of available column ❌ (soft)

**C. 1440 desktop**

- Available after sidebar + padding ≈ **1160px**
- Card = **640** → fails fluid intent; meets bare ≥600 floor only by accident of `40rem` ✅/❌

**D. If Step 2 sets primary to `min(100%, 56.25rem)` (900px) at 1440**

- Card/workspace ≈ **900px** → clears ≥600 and sits at top of 720–900 band ✅

---

## 4. Root causes (ranked)

1. **`--content-queue: 40rem` (640px)** applied on **SwipeDeck**, **CandidateCard**, and **CandidateProgress** — hard ceiling below the 720–900 primary band.
2. **`mx-auto` on SwipeDeck** — centers the 640px deck inside a wider workspace/shell → empty side gutters.
3. **`.hf-review-workspace` / `--content-queue-max: 56rem`** — caps the review section at 896px while the shell offers ~1160px+; does not unblock the card (card is capped lower).
4. **Redundant double lock** — QueueReview `@[900px]:max-w-none` expands chrome, but deck/card ignore it → inconsistent column widths (header can be wider than card).
5. **`--shell-max` + `mx-auto`** — secondary; only matters on very wide screens; not why the card is narrow at 1440.

---

## 5. Proposed token values (Step 2)

```css
:root {
  /* Sidebar: stay inside 210–240px */
  --sidebar-width: 14rem; /* 224px (was 14.5rem / 232px) */

  /* Queue primary: fluid up to ~900px; min reads as “fill parent” via min() */
  --content-queue-min: 0;           /* no artificial floor in px; parent + padding define mobile */
  --content-queue: 45rem;           /* 720px — preferred mid desktop */
  --content-queue-max: 56.25rem;    /* 900px — upper primary band (was 56rem / 896px) */

  /* Shell: allow primary + padding headroom past 1440 content */
  --shell-max: 100rem;              /* 1600px (was 90rem / 1440px) */

  /* Unchanged unless detail Step touches them */
  --content-detail: 48rem;
  --content-rail: 17.5rem;
  --nav-mobile-height: 4.25rem;
}
```

**Fluid width expression** (use as the single queue column rule):

```css
width: 100%;
max-width: min(100%, var(--content-queue-max));
```

Optional mid-desktop preference (only if a pure `min(100%, 900px)` feels too wide on ~1100px shells):

```css
max-width: min(100%, clamp(var(--content-queue), 70cqi, var(--content-queue-max)));
```

Prefer the simpler `min(100%, var(--content-queue-max))` for Step 2 unless QA shows over-wide cards.

### Expected widths after tokens (1440)

| Region | Proposed |
| --- | ---: |
| Sidebar | **224px** |
| Shell content | ~1160px |
| Queue workspace + card | **min(1160, 900) = 900px** |
| Vs acceptance | **900 ≥ 600** ✅ |

### Mobile

| Region | Proposed |
| --- | --- |
| Card | `width: 100%` of `.hf-shell-main` content box (no 440/640 phone cap) ✅ |

---

## 6. Exact CSS / grid / clamp / container-query changes (file + class)

### 6.1 `src/app/globals.css`

1. Replace layout token block with values in §5.
2. Change `.hf-review-workspace` to:

```css
.hf-review-workspace {
  width: 100%;
  max-width: min(100%, var(--content-queue-max));
}
```

3. **Remove or rewrite** the `@container review (min-width: 56rem)` rule — it currently re-states `56rem` and does not help. Either delete it, or replace with a growth rule that matches the card:

```css
@container review (min-width: 48rem) {
  .hf-review-workspace {
    max-width: min(100%, var(--content-queue-max));
  }
}
```

(Only keep a CQ if you later add a 2-column queue + rail; for Step 2, a single max-width is enough.)

4. Add a shared utility for the deck column (optional but clarifying):

```css
.hf-queue-column {
  width: 100%;
  max-width: min(100%, var(--content-queue-max));
}
```

### 6.2 `src/components/shell/AppShell.tsx`

| Change | Why |
| --- | --- |
| Keep `hf-shell-main`; bump token `--shell-max` as above | Headroom for 900px primary + padding |
| Keep `mx-auto` **or** switch to `lg:mx-0` when sidebar present | Avoid double centering (shell + deck). Prefer **one** centering context: shell only on ultra-wide |
| Optional: `lg:px-8` only if primary still feels edge-tight after widening card | Do not increase padding in a way that fights ≥600/720 targets |

No CSS grid required on AppShell for Step 2; current `flex` + sidebar width is fine.

### 6.3 `src/components/shell/Navigation.tsx`

| Change | Why |
| --- | --- |
| Keep `w-[var(--sidebar-width)]` | Token drives 210–240 |
| No change to mobile `max-w-lg` / `items-center` | Does not constrain the card |

### 6.4 `src/components/queue/QueueReview.tsx`

| Change | Why |
| --- | --- |
| Keep `section.hf-review-workspace` | Single outer envelope |
| **Remove** inner `max-w-[var(--content-queue)] @[900px]:max-w-none` wrapper → `w-full` only | Eliminate competing 640px + partial CQ escape |
| Leave `items-center` on action cluster | Alignment only |

### 6.5 `src/components/queue/SwipeDeck.tsx`

| Current | Proposed |
| --- | --- |
| `relative mx-auto w-full max-w-[var(--content-queue)]` | `relative w-full max-w-[min(100%,var(--content-queue-max))]` **or** `hf-queue-column` |
| Drop `mx-auto` | Left-align with header/progress (or keep `mx-auto` **only if** parent is full shell width and you want a centered 900px column — then parent must also be centered once, not twice) |

**Recommended:** parent `.hf-review-workspace` is the only max-width; SwipeDeck is `w-full` with **no** max-w and **no** mx-auto.

### 6.6 `src/components/candidates/CandidateCard.tsx`

| Current | Proposed |
| --- | --- |
| `max-w-[var(--content-queue)]` | **Remove** max-w; keep `w-full` | Parent deck defines width; avoids triple lock |

### 6.7 `src/components/candidates/CandidateProgress.tsx`

| Current | Proposed |
| --- | --- |
| `max-w-[var(--content-queue)]` | `w-full` only (or same `hf-queue-column` as workspace) | Progress matches card width |

### 6.8 `src/components/queue/QueueCardPreview.tsx`

| Current | Proposed |
| --- | --- |
| `items-center` + `max-w-[440px]` | Match production: `hf-review-workspace` / `hf-queue-column`, drop 440px and centering | Design lab stops teaching the old mobile-card width |

### 6.9 Container queries

- Keep `container-type: inline-size` on `.hf-shell-main` for future rail / typography.
- **Do not** use `@[900px]:max-w-none` as the primary growth mechanism — it already proved insufficient because children re-capped.
- If a CQ is kept, gate **layout mode** (e.g. optional side meta), not the card’s max-width.

### 6.10 Grid (optional follow-on, not required for Step 2 acceptance)

Only if adding a desktop context rail beside the deck:

```css
@container review (min-width: 64rem) {
  .hf-review-workspace {
    display: grid;
    grid-template-columns: minmax(0, var(--content-queue-max)) var(--content-rail);
    gap: var(--space-6);
    max-width: none;
  }
}
```

Out of scope for the ≥600px card fix; document for Step 2.1+.

---

## 7. Acceptance checklist (Step 2 QA)

- [ ] **390** — card width ≈ content column (full width minus `px-4`); no horizontal overflow; safe-area padding intact.
- [ ] **768** — card uses full content column (not stuck at 640 if column &gt; 640).
- [ ] **1440** — measured card width **≥ 600px** (target **720–900** once tokens land).
- [ ] **Sidebar** — computed width **210–240px** (proposed **224px**).
- [ ] Header, progress, and card **share the same column width** (no wider chrome over a narrow deck).
- [ ] No permanent instruction banner; shortcuts unchanged.
- [ ] Swipe / keyboard behavior unchanged (layout-only Step 2).

---

## 8. Risks / non-goals

| Risk | Mitigation |
| --- | --- |
| Very wide cards hurt swipe affordance / line length | Cap at `--content-queue-max` (900px); do not fill entire 1160px shell with the card |
| Removing all `mx-auto` left-aligns a 900px column in a 1160px shell | Accept small trailing gap **or** center **once** via `.hf-review-workspace { margin-inline: auto }` |
| Detail page tokens unused | Leave `--content-detail` / rail for a later step |
| Preview page still at 440px | Update `QueueCardPreview` in same PR as tokens so lab matches prod |
| GSAP swipe uses element width | Wider card → slightly longer travel; re-check thresholds if any are pixel-hardcoded |

**Non-goals for this doc:** implementing CSS, committing, discovery/Sheets/Ask changes, auth, migrations.

---

## 9. Summary for implementers

**Top constraints causing the narrow card**

1. `--content-queue: 40rem` (640px) on SwipeDeck + CandidateCard + CandidateProgress  
2. `mx-auto` on SwipeDeck centering that 640px column  
3. `.hf-review-workspace` / `--content-queue-max: 56rem` leaving shell empty while the card stays lower  

**Proposed token values**

| Token | From | To |
| --- | --- | --- |
| `--sidebar-width` | `14.5rem` (232px) | `14rem` (**224px**) |
| `--content-queue` | `40rem` (640px) | `45rem` (**720px** preferred) |
| `--content-queue-max` | `56rem` (896px) | `56.25rem` (**900px**) |
| `--shell-max` | `90rem` (1440px) | `100rem` (**1600px**) |

**Structural rule:** one max-width owner (`.hf-review-workspace` → `min(100%, var(--content-queue-max))`); children `w-full`; delete nested `max-w-[var(--content-queue)]` and deck `mx-auto` (or center the workspace once).
