# Design review — Blueprint visual direction

Figma MCP unavailable; proposals live in design-lab mockups. Screenshots intended at 390×844, 768×1024, 1440×1000 from:

- `docs/design/mockups/blueprint-restrained.html` (Variant A)
- `docs/design/mockups/blueprint-expressive.html` (Variant B)

Prior editorial-operations mockup remains at `docs/design/mockups/editorial-operations.html` (layout/IA reference only).

---

## Steps 13–14 — Blueprint variant comparison

### Intent

Replace generic near-black SaaS neutrals with a **restrained technical blueprint** look: deep navy canvas, lighter blue panels, warm off-white text, fine cyan structure, clear semantic actions — without neon, purple glow, glass, or all-mono UI.

### Variant A — Restrained Blueprint

| Token role | Value | Notes |
|------------|-------|-------|
| Canvas | `#0b1524` | Deep blueprint navy |
| Surface / sidebar | `#101c2e` | Slightly lifted |
| Panel / card | `#142338` | Lighter blue panel |
| Inset | `#0d1829` | Nested fields |
| Elevated | `#182a40` | Active nav / hover |
| Text | `#ebe8e0` | Warm blueprint-paper |
| Muted | `#8fa3b8` | Blue-gray secondary |
| Border | `#2a3f56` | Fine structural line |
| Border strong | `#3d5570` | Hover / emphasis |
| Approve | `#3db87a` | Green, not neon |
| Reject | `#d97868` | Coral |
| Warn | `#d4a04a` | Amber |
| Save / focus | `#5ba8c9` / `#5eb0d4` | Cyan, restrained |
| Grid | cyan @ ~3.5% | Background only |

**Strengths:** Highest body/meta contrast on navy; grid stays behind content; semantic colors readable without competing chrome; calm for long review sessions.

### Variant B — Expressive Blueprint

| Token role | Value | Notes |
|------------|-------|-------|
| Canvas | `#07121f` | Deeper navy |
| Panel / card | `#12304a` | Stronger blue lift |
| Borders | `#2f6f8f` → `#45a0c4` | Cyan-forward structure |
| Muted | `#7eb0cc` | Brighter blue-gray |
| Save / focus | `#4ec8e8` | Stronger cyan |
| Grid | cyan @ ~8.5%, 28px | More visible drafting |
| Buttons / cards | Tinted fills + cyan rim | Stronger identity |

**Strengths:** Clearer “blueprint” identity at a glance; stronger frame on cards and active nav.

**Weaknesses vs A:** Brighter cyan borders and denser grid compete with title/summary; muted text sits closer to accent hue (weaker hierarchy); filled decision buttons add visual noise next to Approve/Save/Reject.

### Selection

**Selected: Variant A — Restrained Blueprint.**

Expressive does **not** clearly win on readability. Restrained preserves warm paper text contrast, quieter structure lines, and semantic color reserved for actions/status — better for daylight and dark environments and for dense queue + detail reading.

### Production mapping (Step 14)

Applied in `src/app/globals.css` `:root` color tokens. Layout tokens (`--content-queue`, `.hf-shell-main`, etc.) unchanged. Component classes (`.grid-background`, `.hf-panel`, `.hf-card`, buttons, focus) retuned to cyan-structural borders and blueprint surfaces.

---

## Scan order (queue) — preserved from editorial ops

1. Status/context (New · Web)  
2. Title  
3. Date / location / mode  
4. Concise summary  
5. Deadline / eligibility  
6. Strongest evidence line  
7. Approve / Reject / Save  

## Dominant action

**Approve** remains visually primary among decisions (stronger border/color weight). Reject uses coral (blueprint semantic), not quiet gray. Save is cyan. No competing neon score orb in the first viewport.

## Why this avoids generic generated-dashboard styling

- No purple glow, glass stacks, or hero gradients.  
- Deep navy + paper text instead of near-black SaaS neutrals.  
- Fine cyan hairlines and a subtle drafting grid on the page background only.  
- Document serif titles + mono meta; not badge soup or all-mono chrome.

---

## Step 3 — Drafting Sheet authenticity

Prior Restrained Blueprint fixed contrast but still read as dark SaaS. Step 3 compared:

| Variant | Lab mockup | Outcome |
|---------|------------|---------|
| A — Drafting Sheet | `docs/design/mockups/blueprint-drafting-sheet.html` | **Selected** |
| B — Modern Blueprint | `docs/design/mockups/blueprint-modern.html` | Fallback only |

Full selection rationale + production token map: `docs/design/BLUEPRINT_COMPARISON.md`.

Production now ships cobalt paper (`#0c2748`), warm ink (`#f0ebe2`), major/minor grid, double-line `.hf-panel`/`.hf-card`, corner registration, flat shadows (`none`), and `src/components/blueprint/*` primitives. No aircraft wallpaper, neon, or blur mobile nav.
