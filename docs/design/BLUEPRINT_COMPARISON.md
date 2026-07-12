# Blueprint authenticity comparison — Step 3

**Reference:** `artifacts/design/blueprint-reference.png`  
**Gap analysis:** `docs/design/BLUEPRINT_GAP_ANALYSIS.md`  
**Lab mockups:**

| Variant | Path |
|---------|------|
| A — Drafting Sheet | `docs/design/mockups/blueprint-drafting-sheet.html` |
| B — Modern Blueprint | `docs/design/mockups/blueprint-modern.html` |

Capture intents (lab frames): 390×844, 768×1024, 1440×1000. Screenshot paths for QA may land under `artifacts/design/` when visual QA runs.

---

## Glance test vs reference

| Criterion | Drafting Sheet (A) | Modern Blueprint (B) |
|-----------|--------------------|----------------------|
| Cobalt drafting paper (not flat SaaS navy) | Yes — saturated `#0c2748` canvas | Partial — keeps `#0b1524` product navy |
| Major + minor grid | Yes — warm ink 64 / 8 | Yes — quieter 7% / 3% |
| Double-line sheet frame | Yes — outer + faint inner gap | No — single ink border |
| Corner registration | Yes — L-marks on panels | Light ticks only |
| Warm off-white ink | `#f0ebe2` | `#ebe8e0` (kept) |
| Flat panels / no drop shadow | Yes | Yes |
| Squareish radius | 2px sheet / 3px controls | 8px cards / 6px controls |
| Authenticity at first glance | Passes drafting-sheet test | Still reads as restrained dark product UI |

---

## Usability

| Criterion | Drafting Sheet (A) | Modern Blueprint (B) |
|-----------|--------------------|----------------------|
| Body / title contrast on cobalt | AA with warm ink; grid capped | Proven from Step 14 |
| Queue scan speed | Preserved — structure on chrome, not body | Safest continuity |
| Focus ring | Hard cyan drafting line | Soft cyan ring (closer to prior) |
| Mobile nav | Opaque cobalt (no blur) | Opaque navy (no blur) |
| Risk | Grid too loud on small screens → minors weaken | May fail authenticity glance test |

---

## Selection

**Selected: Variant A — Drafting Sheet.**

Rationale (aligned with gap analysis lean):

1. Prior *Restrained vs Expressive* only varied cyan intensity on the same SaaS card model — authenticity failed for structural reasons (frame, grid hierarchy, ink, registration, anti-shadow).
2. Drafting Sheet changes **primitives**: major/minor grid, double-line borders, corner marks, flat square panels, warm ink construction lines.
3. Modern Blueprint is retained as the documented fallback if daylight contrast or queue scan-speed QA fails.

**Rejected for production (this step):** Variant B — Modern Blueprint (kept as lab fallback only).

---

## Production token map (Drafting Sheet)

| Token | Value | Role |
|-------|-------|------|
| `--background` | `#0c2748` | Cobalt drafting paper |
| `--surface` | `#0f2d52` | Sidebar / title-block field |
| `--card` / `--panel` | `#123258` | Sheet panels |
| `--inset` | `#0a1f3d` | Nested fields |
| `--elevated` | `#163860` | Active/hover lift |
| `--foreground` | `#f0ebe2` | Warm off-white ink |
| `--muted` | `#9eb0c4` | Secondary blue-gray |
| `--muted-strong` | `#b4c2d2` | Stronger secondary |
| `--border` | ink-mix ~32% foreground | Construction hairline |
| `--border-subtle` | ink-mix ~18% | Faint rules |
| `--border-strong` | ink-mix ~48% | Emphasis |
| `--ink-line` | foreground @ 55% | Primary double-border ink |
| `--ink-line-strong` | foreground @ 78% | Outer frame / registration |
| `--ink-line-faint` | foreground @ 22% | Minor grid / dashed |
| `--grid-major` | warm ink ~12% | Major squares |
| `--grid-minor` | warm ink ~5% | Subdivision |
| `--grid-major-size` | `64px` | Major pitch |
| `--grid-minor-size` | `8px` | Minor pitch |
| `--accent-focus` | `#6ec4d8` | Drafting cyan focus only |
| `--accent-approve` / `reject` / `warn` / `save` | Keep family | Semantics unchanged |
| `--radius-sheet` | `2px` | Panels / frames |
| `--radius-control` | `3px` | Buttons / inputs |
| `--radius-sm`…`xl` | Retuned toward sheet | Less SaaS rounding |
| `--shadow-card` / `--shadow-soft` | `none` | Ink on paper |
| `--frame-gap` | `3px` | Double-line gap |

---

## Shared CSS primitives (production)

| Class / component | Spec |
|-------------------|------|
| `.hf-sheet-grid` (alias `.grid-background`) | Major + minor `repeating` gradients; minors weakened on small viewports |
| `.hf-sheet-frame` | Double-line border via border + outline |
| `.hf-corner-marks` | Four corner L-registration ticks |
| `.hf-panel` / `.hf-card` | Flat, squareish, double hairline, no shadow |
| `.hf-title-block` | Compact mono meta strip |
| `.hf-rule-dashed` | Dashed secondary separator |
| `.hf-technical-label` | Mono uppercase meta label |
| `.hf-status-stamp` / `.hf-source-stamp` | Quiet status / source chips |
| React wrappers | `src/components/blueprint/*` |

---

## Accessibility notes

- `:focus-visible` ≥ 2px hard cyan (`--accent-focus`), not soft glow blob.
- Touch targets remain ≥ 44px via `.hf-touch` / button min-heights.
- Decorative registration / ticks: `pointer-events: none`; static under `prefers-reduced-motion`.
- Grid is background-only; never painted inside text blocks.
- No neon, glass primary nav, purple, or aircraft wallpaper imagery.
