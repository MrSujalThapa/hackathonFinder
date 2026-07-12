# Visual system — Editorial operations workspace

Product direction for Hackathon Finder review UI.  
Skill process from Impeccable/Clean/Editorial; palette adapted for a dark private review desk (not cream/poster, not purple SaaS).

## Intent

Dense but calm. Left-aligned hierarchy. Clear approve/reject/save. Document-style candidate investigation. Evidence ordered by credibility. Restrained semantic color. Minimal decoration.

## Typography

| Token | Size | Use |
|-------|------|-----|
| `text-2xs` | 11px | Caps labels, meta |
| `text-xs` | 12px | Secondary meta, chips |
| `text-sm` | 14px | Body UI, lists |
| `text-base` | 16px | Primary body / Ask answers |
| `text-lg` | 18px | Section titles (detail) |
| `text-xl` | 20px | Queue card title |
| `text-2xl` | 24px | Page title |
| `text-3xl` | 30px | Login brand |

- **UI sans:** Geist Sans (existing) — chrome, controls, metadata  
- **Document display:** Source Serif 4 or similar for candidate titles on detail only  
- **Mono:** Geist Mono for locations, URLs, ids  
- Line-height: 1.45 body, 1.25 titles  
- Tracking: labels +0.08em uppercase

## Spacing (4pt base)

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48`

Section gaps: 24px. Stack gaps inside sections: 12–16px. Page padding: 16 mobile / 24 desktop.

## Layout grid

- Mobile: single column, content `min(100%, 40rem)`  
- Tablet ≥768: content `min(100%, 44rem)`  
- Desktop ≥1024: shell sidebar 14rem + content  
- Detail ≥1200: primary column `minmax(0, 42rem)` + rail `18rem`  
- Queue card max width: `27.5rem` centered in content

## Surfaces (Drafting Sheet — Step 3)

Canonical authenticity comparison: `docs/design/BLUEPRINT_COMPARISON.md`.

| Token | Value | Use |
|-------|-------|-----|
| `--background` | `#0c2748` | Cobalt drafting paper |
| `--surface` | `#0f2d52` | Sidebar / title block |
| `--card` / `--panel` | `#123258` | Sheet panels |
| `--inset` | `#0a1f3d` | Nested fields |
| `--elevated` | `#163860` | Active / hover lift |
| `--ink-line*` | warm foreground mixes | Construction / double borders |
| `--grid-major` / `--grid-minor` | ~12% / ~5% warm ink | Background grid only |

No gradients as primary surfaces. No glass/blur primary nav. No aircraft wallpaper.

## Radii

`--radius-sheet` 2px · `--radius-control` 3px · sm–xl retuned toward sheet. Avoid pills except true circular affordances.

## Shadows

None by default (`--shadow-card` / `--shadow-soft`: `none`). Ink sits on paper.

## Semantic colors

| Role | Color | Use |
|------|-------|-----|
| Text | `#f0ebe2` | Warm off-white ink |
| Muted | `#9eb0c4` | Secondary blue-gray |
| Approve | `#3db87a` | Approve |
| Save / focus | `#5ba8c9` / `#6ec4d8` | Save, links, hard focus ring |
| Reject | `#d97868` | Reject |
| Warn | `#d4a04a` | NEEDS_REVIEW, uncertainty |
| Danger | `#d97868` | Errors / destructive |

## Source credibility levels

| Level | Label | Cue |
|-------|-------|-----|
| 5 | Official | Left border emerald, label Official |
| 4 | Application | Left border sky, label Apply |
| 3 | Directory | Left border slate |
| 2 | Social | Left border muted violet-gray (no glow) |
| 1 | Article / other | Left border amber-muted |

Order evidence by level desc, then last verified.

## Interaction states

- Hover: border → `--ink-line-strong` or text → foreground (150ms)  
- Focus-visible: 2px hard ring `--accent-focus` (`#6ec4d8`), offset 2px  
- Disabled: opacity 0.4, no pointer  
- Active press: slight opacity dip (CSS only)  
- Loading: skeleton bars matching layout, not spinner-only

## Motion rules

- CSS for hover/focus/color  
- GSAP only: queue exit/entrance, restore entrance, meaningful disclosure expand, rare state feedback  
- Prefer `x`/`y`/`autoAlpha`; duration 0.2–0.35s; ease `power2.out`  
- `prefers-reduced-motion: reduce` → instant set / no timeline  
- No permanent `will-change`; cleanup via `useGSAP` / context revert

## Responsive rules

- Touch targets ≥44px for primary actions  
- Mobile: sticky decision bar above bottom nav; safe-area insets  
- Desktop: do not center everything — left-align document; use rail  
- Hide decorative grid intensity on small screens if it harms contrast

## Anti-patterns (forbidden)

- Purple glow / indigo SaaS gradients  
- Glassmorphism stacks  
- Card wrapping every section  
- Excessive pill badges  
- Arbitrary page-enter animations  
- Animating layout width/height for routine UI
