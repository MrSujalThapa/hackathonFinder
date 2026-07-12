# Design skill notes — Phase 10.2

Extracted from skills opened for the Hackathon Finder design overhaul.  
Direction for this product: **Editorial operations workspace** (dark review desk), not the upstream light cream/poster palettes.

## Skills actually opened

| File | Opened |
|------|--------|
| `agents.md` | yes |
| `.agents/skills/impeccable/SKILL.md` | yes |
| `.agents/skills/impeccable/DESIGN.md` | yes |
| `.agents/skills/editorial/SKILL.md` | yes |
| `.agents/skills/editorial/DESIGN.md` | yes |
| `.agents/skills/clean/SKILL.md` | yes |
| `.agents/skills/clean/DESIGN.md` | yes |
| `.agents/skills/gsap-core/SKILL.md` | yes |
| `.agents/skills/gsap-react/SKILL.md` | yes |
| `.agents/skills/gsap-timeline/SKILL.md` | yes |
| `.agents/skills/gsap-performance/SKILL.md` | yes |
| `.agents/skills/webapp-testing/SKILL.md` | yes |

## Precedence applied

1. Accessibility and correctness  
2. Impeccable — consistency and completeness  
3. Clean — hierarchy and restraint  
4. Editorial — candidate-detail / evidence reading  
5. GSAP — motion only  
6. Webapp-testing — rendered inspection / QA  

## Concrete rules by skill

### Accessibility (shared across impeccable / editorial / clean)

- WCAG 2.2 AA; keyboard-first; visible `focus-visible` states.
- Semantic HTML before ARIA.
- Screen-reader-tested labels; 44px+ touch targets (editorial + clean).
- Reduced-motion support required.
- When aesthetics conflict with a11y, prioritize a11y.
- Empty / loading / error states must be designed, not accidental.

### Impeccable (consistency / completeness)

- Prefer semantic tokens over raw values.
- Preserve visual hierarchy; keep interaction states explicit.
- Define tokens before components.
- Required states: default, hover, focus-visible, active, disabled, loading, error.
- Spacing scale discipline: 4/8/12/16/24/32.
- Type scale discipline: 12/14/16/20/24/32.
- Radii: sm 4px, md 8px (upstream); adapt to product tokens.
- Do not depend on vague adjectives — anchor to tokens/thresholds.
- Anti-patterns: low-contrast text, inconsistent spacing, ambiguous labels.
- **Palette adaptation:** upstream cream/amber poster look is **not** adopted for this product (conflicts with review-workspace direction and anti–AI-cream rules). Keep the *process* (tokens → components → QA), not the cream/orange brand colors.

### Clean (hierarchy / restraint)

- Minimize visual clutter; limited semantic color.
- Design empty/loading/error explicitly.
- Avoid decorative motion without purpose.
- Prefer ample whitespace *where it aids scan* — for dense review UI, use restraint via fewer nested cards and quieter chrome, not sparse empty pages.
- **Palette adaptation:** do not adopt upstream `#8B5CF6` secondary (purple) or generic blue SaaS primary.

### Editorial (candidate detail / evidence)

- Magazine/document reading experience: structured grids, clear reading column.
- Stronger type hierarchy for long-form content (14/16/18/24/32/40 upstream).
- 8pt baseline rhythm for document sections.
- Left-aligned hierarchy; evidence as cited sources in a document, not a dashboard card stack.
- **Type adaptation:** use a purposeful display/serif for titles where it strengthens document feel; keep UI chrome in a clean sans. Do not force light `#FFFFFF` surfaces onto the dark review workspace.

### GSAP core

- Prefer transforms (`x`/`y`/`scale`/`rotation`) and `autoAlpha`/`opacity`.
- Use `gsap.matchMedia` / reduced-motion awareness for responsive animation.
- Prefer built-in eases (`power2.out`, etc.); avoid novelty eases for UI chrome.
- `clearProps` when CSS should resume control after motion.

### GSAP React

- Prefer `useGSAP` with `scope` ref; automatic cleanup.
- Use `contextSafe` for event-created tweens.
- Fallback: `gsap.context` + `ctx.revert()` in effect cleanup.
- Avoid hydration issues: animate after mount; do not mismatch SSR markup.

### GSAP timeline

- Sequence exit → entrance with position parameters (`"+=0.05"`, `"<"`).
- Timeline `defaults` for shared duration/ease.
- Use for queue card handoff, not decorative page intros.

### GSAP performance

- Prefer transform/opacity; avoid animating width/height/top/left.
- Do not set permanent `will-change` on everything.
- Kill/cleanup off-screen animations; no hundreds of simultaneous tweens.
- Stagger when many identical motions; otherwise keep motions few and purposeful.

### Webapp-testing

- Run helper scripts with `--help` first; treat `with_server.py` as a black box.
- Dynamic apps: wait for `networkidle` before inspecting.
- Reconnaissance-then-action: screenshot/DOM first, then selectors.
- Capture console; always close the browser.
- Headless Chromium for automation scripts.

## Official Figma MCP (Step 1)

| Question | Result |
|----------|--------|
| Official Figma MCP found | **no** |
| Connected | **no** |
| Usable without payment | **unknown** (not present) |
| Available tools | none matching `figma` / `Figma` |
| Can read/create/edit files | **no** |
| Figma file accessed | **no** |

Continue with a **local non-production design lab** under `docs/design/mockups/` (not linked from production navigation).

## Product synthesis (what we will actually build)

- Dark, calm editorial operations workspace.
- Dense but scannable queue; document-style candidate detail.
- Semantic approve / save / reject / warn only.
- Evidence ordered by authority; collapsed technical history.
- GSAP only for queue handoff + meaningful disclosures.
- CSS for hover/focus/color.
- No purple glow, no glassmorphism, no generic SaaS gradients, no card-per-section.
