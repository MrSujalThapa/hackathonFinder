# Motion audit

GSAP usage after Phase 10.2 editorial overhaul. Skills: `gsap-core`, `gsap-react`, `gsap-timeline`, `gsap-performance`.

| Location | Animation | Why GSAP | Reduced motion |
|----------|-----------|----------|----------------|
| `SwipeDeck` entrance | `fromTo` y/scale on new card | Coordinated card handoff after decision | Instant set / skip |
| `SwipeDeck` exit | `to` x/rotation/autoAlpha on approve/reject/save | Directional exit communicates decision | Near-zero duration |
| `SwipeDeck` restore/reset | `set` clear transform | Avoid leftover inline styles | Same |
| `useExpandMotion` (evidence Show all, technical history) | height/opacity expand | Meaningful disclosure; CSS height:auto is awkward | Instant height set |

## Not using GSAP for

- Hover / focus / color (CSS)
- Page enter on login/settings/lists
- Background/grid motion
- ScrollTrigger / pin effects

## Implementation notes

- `useGSAP` + scoped refs in `SwipeDeck`; plugin registered once.
- Expand helper uses `gsap` with `prefers-reduced-motion` check; cleanup via layout effect updates.
- Prefer transform/opacity; no permanent `will-change`.
- Optimistic queue state remains driven by decision handlers, not tween completion alone (exit awaits then decides).
