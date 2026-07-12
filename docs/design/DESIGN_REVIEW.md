# Design review — proposed Editorial operations UI

Figma MCP unavailable; proposals live in `docs/design/mockups/editorial-operations.html` with screenshots in `artifacts/design/proposed/`.

## Scan order (queue)

1. Status/context (New · Web)  
2. Title  
3. Date / location / mode  
4. Concise summary  
5. Deadline / eligibility  
6. Strongest evidence line  
7. Approve / Reject / Save  

## Dominant action

**Approve** is visually primary among decisions (stronger border/color weight). Reject stays quiet gray. Save is informational blue. No competing neon score orb in the first viewport.

## De-emphasized information

- Score moves to detail rail (or small meta), not a glowing circle on the card.  
- Theme pills removed from first viewport.  
- Keyboard hints live in desktop lede, not under cramped buttons.  
- Technical history collapsed behind a single summary line.

## Evidence hierarchy

Official → Apply → Directory → Social/Article. Left-border credibility cue + label. Seen count only when >1. No duplicate official/apply pair cards.

## Candidate-detail structure

- **Desktop:** document column + facts/actions rail.  
- **Mobile:** single column; decisions sticky above bottom nav.  
- Ask sits in the investigation flow after sources.  
- Activity secondary under Ask.

## Mobile behavior

44px decision targets; bottom nav remains; card content no longer fights oversized circular buttons.

## Desktop layout

Sidebar + intentional content width; detail uses two columns ≥1200px.

## Ask integration

Composer + “shortcuts not limits” copy; chips optional; answers show certainty + citations.

## Why this avoids generic generated-dashboard styling

- No purple glow, glass stacks, or hero gradients.  
- Document serif titles + mono meta instead of badge soup.  
- Flat panels with hairline borders; one shadow on the active review card.  
- Left-aligned editorial hierarchy rather than centered SaaS marketing cards.
