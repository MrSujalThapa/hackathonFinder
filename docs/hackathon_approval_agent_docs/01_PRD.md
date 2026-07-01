# PRD — Hackathon Approval Agent

## 1. Product Overview

### 1.1 Working Name

**Hackathon Approval Agent**  
Possible future product names: HackSwipe, Huntboard, HackRadar, ApplyDeck, EventScout.

### 1.2 One-Line Pitch

A mobile-first Tinder-style approval queue for hackathons: agents discover events, summarize them, dedupe them, and only add approved opportunities to your Google Sheet.

### 1.3 Problem

Finding hackathons is fragmented and annoying. Good opportunities appear across Devpost, MLH, Luma, HackList, Hakku, X/Twitter posts, Instagram posts, LinkedIn posts, school pages, sponsor pages, and random web searches. The user currently has to search manually, compare dates/location/themes, open many tabs, and copy information into a spreadsheet.

### 1.4 Solution

Build an agentic workflow that:

1. Discovers candidate hackathons from structured sources and social/web leads.
2. Extracts normalized event data.
3. Verifies dates, location, deadlines, links, and eligibility.
4. Dedupes already-seen hackathons.
5. Creates a short approval card.
6. Lets the user swipe/approve/reject/save from a mobile web UI.
7. Appends only approved candidates to Google Sheets.
8. Keeps rejected/saved candidates in history so the user can revisit them.

## 2. Goals

### 2.1 User Goals

- Find upcoming hackathons faster.
- Avoid duplicate events.
- Review opportunities on a phone with almost zero friction.
- Approve good events into a clean spreadsheet.
- Reject or save events without losing history.
- Ask the agent follow-up questions such as:
  - What is the deadline?
  - Is this remote?
  - Is this open to students?
  - What are the prizes?
  - Is there an official application page?

### 2.2 Product Goals

- Low latency: candidate cards should load instantly after discovery.
- Low friction: approval requires one tap or swipe.
- Free-to-build MVP: local CLI worker, Supabase free tier, Vercel Hobby UI, Google Sheets final output.
- Real agentic workflow: planner, source tools, extraction, verification, dedupe, scoring, enrichment, and approval actions.
- Mobile-first UI inspired by the provided dark Tinder-style card design.

### 2.3 Non-Goals for MVP

- No Twitter/X DMs for approval.
- No logged-in scraping of Instagram or LinkedIn.
- No paid hosted browser worker.
- No automatic application submission.
- No always-on cloud worker required.
- No complex team/multi-user roles in MVP.

## 3. Target User

Primary user: a student/builder looking for AI, agent, cloud, fintech, healthcare, cybersecurity, web3, and developer-tool hackathons near Toronto/Waterloo/Mississauga/Canada or remote.

## 4. Core User Flows

### 4.1 Discover from CLI

User runs:

```bash
npm run agent -- "find upcoming AI agent hackathons in Toronto, Waterloo, Canada, or remote"
```

System:

1. Parses the command into preferences.
2. Searches configured sources.
3. Creates or updates candidates in Supabase.
4. Prints a summary:
   - raw found
   - deduped
   - new candidates
   - updated candidates
   - rejected
   - needs review
5. User opens the mobile web UI to review.

### 4.2 Review on Phone

User opens `/queue` on phone.

The UI shows one candidate card at a time:

- event name
- summary
- date
- deadline
- location
- mode
- source link
- score
- why it matches
- red flags

Actions:

- Swipe right / tap check = approve
- Swipe left / tap X = reject
- Tap bookmark = save for later
- Tap card = detail sheet
- Tap “Find more info” = agent enrichment

### 4.3 Approve Candidate

User approves candidate.

System:

1. Changes candidate status to `APPROVED`.
2. Appends row to Google Sheets.
3. Stores `approved_at` and `sheet_row_id` if available.
4. Removes card from active queue.

### 4.4 Reject Candidate

User rejects candidate.

System:

1. Changes status to `REJECTED`.
2. Stores `rejected_at` and optional reason.
3. Does not delete the candidate.
4. Candidate remains visible under `/rejected` and can later be approved.

### 4.5 Save for Later

User saves candidate.

System changes status to `SAVED_FOR_LATER`. Candidate appears under `/saved`.

### 4.6 Ask Follow-Up

User asks: “What is the application deadline?”

System:

1. Reads candidate evidence.
2. Performs targeted web/source lookup.
3. Updates fields if new information is found.
4. Stores answer in `candidate_answers`.
5. Displays concise answer with source links.

## 5. Sources

### 5.1 MVP Sources

- HackList: `https://hacklist-omega.vercel.app/`
- Hakku: `https://tryhakku.vercel.app/swipe`
- Devpost
- MLH
- Luma search/web search
- General web search
- Manual Leads tab or UI paste box

### 5.2 Social Sources

#### X/Twitter

Use X/Twitter MCP/API as a lead discovery source. Store posts as evidence. Do not use X DMs for approval in MVP. The approval flow happens in the mobile web UI.

#### Instagram

No logged-in scraping. MVP supports manual social leads. Later version may support official Instagram Graph API hashtag search if credentials exist.

#### LinkedIn

No logged-in scraping. MVP supports manual social leads and public web-search leads.

## 6. Candidate Statuses

```text
NEW
NEEDS_REVIEW
APPROVED
REJECTED
SAVED_FOR_LATER
EXPIRED
DUPLICATE
ERROR
```

## 7. Scoring Rules

Initial weighted scoring:

- +30 location match: Toronto, Waterloo, Mississauga, Canada
- +25 remote/online
- +10 per preferred theme: AI, agents, cloud, developer tools, fintech, healthcare, cybersecurity, web3
- +15 deadline still open
- +10 has official/apply URL
- +10 student-friendly
- +10 prize/sponsor listed
- -50 clearly past event
- -40 no official/apply URL
- -25 unclear date/deadline
- -20 location impossible or irrelevant

Score bands:

- 80+ = strong match
- 55–79 = reviewable
- below 55 = reject or needs review unless manually requested

## 8. Dedupe Requirements

The product must not create duplicate hackathons repeatedly.

Dedupe by:

1. official URL
2. apply URL
3. social URL/post ID
4. source-specific event ID
5. normalized name + normalized location + date/deadline
6. normalized name + official domain

If a duplicate is found with new information, update the existing candidate instead of creating a new one.

## 9. UX Requirements

### 9.1 Card UX

The UI should look close to the provided reference:

- dark grid background
- large centered mobile card
- top visual/header area with gradient fade
- small status pill/tag in the top-right
- bold title
- underlined/monospace-ish location
- short readable summary
- date row with icon
- link row with icon
- bottom approve/reject buttons
- tap card for details

### 9.2 Mobile Requirements

- Responsive on iPhone-sized screens.
- Buttons must be thumb-friendly.
- Swipe gestures should feel natural but buttons must always work.
- Queue should work without keyboard.
- Approved sheet link should be accessible from the top nav.

### 9.3 Latency Requirements

- Queue page first render under 1 second after candidates exist.
- Approve/reject action optimistic UI under 200 ms.
- Sheet append can happen asynchronously but must show success/error state.
- Discovery can take longer, but should run in background/CLI and store candidates incrementally.
- LLM use should be minimized: use deterministic parsers first, LLM only for extraction/verification when needed.

## 10. Functional Requirements

### FR1 — CLI Agent

The CLI accepts natural language commands:

```bash
npm run agent -- "find upcoming hackathons"
npm run agent -- "/find hackathons in Toronto"
npm run agent -- "search hackathons in Toronto from 2026-07-01 to 2026-08-31"
npm run agent -- "find AI agent hackathons remote or near Waterloo"
```

### FR2 — Candidate Queue

All discovered events are stored in Supabase as candidates.

### FR3 — Mobile Approval UI

The UI displays candidates one at a time and supports approve, reject, save, undo, and details.

### FR4 — Google Sheets Write

Only approved candidates are appended to Google Sheets.

### FR5 — Rejected/Saved History

Rejected and saved candidates remain stored and can be reviewed later.

### FR6 — Enrichment

User can ask follow-up questions about a candidate.

### FR7 — Social Leads

X/Twitter MCP is supported as a lead source. Instagram/LinkedIn are supported through manual leads and web-search leads, not logged-in scraping.

## 11. Acceptance Criteria

MVP is complete when:

1. `npm run agent -- "find upcoming hackathons"` creates candidates in Supabase.
2. Duplicate runs do not create duplicate candidates.
3. `/queue` shows candidate cards on mobile.
4. Approve appends one row to Google Sheets.
5. Reject stores the candidate as rejected and keeps it revisitable.
6. Save for later stores candidate under `/saved`.
7. Find-more-info updates candidate details and displays a concise answer.
8. X/Twitter collector can be enabled when credentials are configured.
9. The app works without paid infrastructure for MVP-scale usage.
