# Design UX Spec — Mobile Tinder-Style Approval Queue

## 1. Design Direction

The UI should feel like a premium mobile approval deck, inspired by the provided screenshot:

- dark background
- subtle grid pattern
- centered tall card
- top visual region with gradient fade
- high-contrast white typography
- small source/status pill
- location in muted monospace style
- concise summary
- date and link rows with icons
- large circular bottom actions
- swipe gestures plus tap buttons

The app should not feel like a spreadsheet or admin dashboard. It should feel like a quick decision surface.

## 2. Main Screens

### 2.1 Queue Screen

Route: `/queue`

Purpose: show one hackathon candidate at a time.

Layout:

```text
Top nav
  Hackathon Radar          Open Sheet

Hint text
  Tap card to view details

Candidate card
  Image/visual gradient region
  Source/status pill
  Title
  Location
  Summary
  Date row
  Link row

Bottom actions
  Reject      Save      Approve
```

### 2.2 Candidate Detail Sheet

Triggered by tapping the card.

Shows:

- full description
- official URL
- apply URL
- social/source URLs
- evidence list
- score breakdown
- why match
- red flags
- follow-up question input
- previous answers

### 2.3 History Screens

Routes:

- `/approved`
- `/rejected`
- `/saved`

Each shows compact cards with restore/approve actions.

### 2.4 Settings Screen

Route: `/settings`

Shows:

- Google Sheet link
- enabled sources
- default locations/themes
- X MCP status
- search provider status
- Supabase connection status

## 3. Card Anatomy

```text
┌───────────────────────────────┐
│ Visual header / gradient fade │
│                     AI EVENT  │
├───────────────────────────────┤
│ Hackathon Name                │
│ Toronto, Canada               │
│                               │
│ Short summary, 2–4 lines.     │
│                               │
│ 📅 Sep 13–15                  │
│ 🔗 official-site.com          │
│                               │
└───────────────────────────────┘
```

Required fields:

- name
- location/mode
- summary
- date/deadline if available
- official/apply link if available
- source/status pill

If date is missing, show:

```text
Date unclear
```

If official URL is missing, show a red flag:

```text
Needs official link
```

## 4. Actions

### 4.1 Approve

UI:

- Swipe right or tap check button.
- Card exits right.
- Next card appears.
- Optimistic status update.

Server:

- status becomes `APPROVED`.
- candidate is appended to Google Sheets.
- action is logged.

### 4.2 Reject

UI:

- Swipe left or tap X button.
- Card exits left.
- Next card appears.

Server:

- status becomes `REJECTED`.
- action is logged.
- candidate remains accessible under `/rejected`.

### 4.3 Save for Later

UI:

- Tap bookmark button.
- Card exits down or fades.

Server:

- status becomes `SAVED_FOR_LATER`.
- candidate appears under `/saved`.

### 4.4 Undo

MVP:

- Allow undo for the latest local action if candidate has not been sheet-mutated.
- For approved items already appended to Sheets, warn instead of deleting from sheet.

## 5. Follow-Up Interaction

In detail sheet:

```text
Ask agent:
[ What is the deadline?              ] [Ask]
```

Suggested chips:

- Deadline?
- Remote?
- Open to students?
- Prizes?
- Sponsors?
- Apply link?

Answer style:

```text
The deadline appears to be Aug 20, 2026. The official page says applications close before the event starts on Sep 13. Confidence: medium.
```

Also update the card field if the answer resolves missing data.

## 6. Visual Style

### 6.1 Colors

Use dark-first palette:

```text
Background: near-black
Grid lines: low-opacity blue-gray
Card: black / deep charcoal
Border: dark gray
Primary text: white
Secondary text: blue-gray
Accent approve: green
Accent reject: slate/red-gray
Links: blue
Warning: amber/red
```

### 6.2 Typography

- Title: bold, large, tight line height.
- Location: smaller, muted, slight mono/letterspacing.
- Summary: readable, 2–4 lines.
- Metadata rows: medium size, icon-aligned.

### 6.3 Motion

Use GSAP or Framer Motion. Keep motion smooth but not flashy.

Recommended interactions:

- drag card horizontally
- rotate slightly with drag distance
- threshold swipe to decide
- snap back if below threshold
- approve card flies right
- reject card flies left
- next card scales/fades in

Animation rules:

- Keep animations under 300 ms.
- Respect reduced-motion preference.
- Buttons must work even if gestures fail.
- Do not block API calls on animation completion.

## 7. Mobile Responsiveness

Target:

- iPhone SE width and above
- common Android phone widths
- desktop centered phone-like layout

Rules:

- Card max width around 420 px.
- Card min height around 620 px on desktop, adaptive on mobile.
- Bottom action buttons fixed below card when possible.
- Avoid tiny tap targets.
- Use `safe-area-inset-bottom` for phone browsers.

## 8. Empty States

### No New Candidates

```text
No new hackathons to review.
Run the agent to discover more.

npm run agent -- "find upcoming hackathons in Toronto or remote"
```

### Source Error

```text
Some sources failed during the last run.
Review agent run logs for details.
```

### Sheets Error

```text
Approved locally, but Google Sheets append failed.
Retry sheet append from the candidate detail page.
```

## 9. Low-Friction Requirements

- `/queue` should be the default screen.
- User should not have to open the spreadsheet unless they want to.
- Spreadsheet link is always one tap away.
- Approve/reject does not require confirmation.
- Rejected items are recoverable, so accidental rejection is low-risk.
- Manual lead paste should be quick.

## 10. Design Implementation Notes

Use the provided screenshot as visual reference, not a pixel-perfect clone.

Suggested component structure:

```text
components/
  CandidateCard.tsx
  SwipeDeck.tsx
  ActionButtons.tsx
  DetailSheet.tsx
  EvidenceList.tsx
  ScoreBadge.tsx
  SourcePill.tsx
  EmptyState.tsx
  TopNav.tsx
```

Use the design skills repository as context for stronger visual polish. Use GSAP skills only if choosing GSAP for the swipe deck. Keep dependencies minimal for MVP.
