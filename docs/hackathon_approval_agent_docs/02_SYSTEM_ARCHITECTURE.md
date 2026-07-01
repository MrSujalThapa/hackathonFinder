# System Architecture — Hackathon Approval Agent

## 1. High-Level Architecture

```text
Local CLI Agent
  ├─ Parses user command
  ├─ Plans source searches
  ├─ Calls collectors/tools
  ├─ Extracts events
  ├─ Verifies official info
  ├─ Dedupes and scores
  └─ Upserts candidates into Supabase

Supabase/Postgres
  ├─ candidates
  ├─ candidate_evidence
  ├─ candidate_answers
  ├─ candidate_actions
  └─ agent_runs

Next.js Mobile Web UI
  ├─ Queue card swiper
  ├─ Candidate detail sheet
  ├─ Approve/reject/save actions
  ├─ Find-more-info action
  └─ Google Sheet quick link

Google Sheets
  └─ Approved hackathons only
```

## 2. Deployment Model

### 2.1 Free MVP Deployment

- **Agent runner:** local machine via CLI.
- **UI:** Next.js deployed to Vercel Hobby or run locally.
- **Database:** Supabase free project.
- **Final output:** Google Sheets.
- **Heavy browser automation:** local Playwright inside CLI, not Vercel serverless.

Reasoning: Hakku and some dynamic pages may need Playwright. Running Playwright locally is more reliable and free than forcing browser automation into serverless functions.

### 2.2 Runtime Split

```text
Discovery and extraction = CLI/local worker
Review and approval = mobile web app
Persistent state = Supabase
Final approved tracker = Google Sheets
```

This keeps UI latency low because the UI only reads already-stored candidates.

## 3. Agentic Workflow

The product should not be a single scraping script. It should be a multi-stage agent system with tools and state.

### 3.1 Agents

#### 3.1.1 Controller Agent

Responsibilities:

- Parse the user command.
- Build a discovery plan.
- Select which source tools to run.
- Set search constraints such as dates, location, themes, and mode.
- Coordinate all other agents.

Input:

```json
{
  "command": "find AI agent hackathons in Toronto or remote from July to September"
}
```

Output:

```json
{
  "locations": ["Toronto", "Remote"],
  "themes": ["AI", "agents"],
  "dateRange": { "start": "2026-07-01", "end": "2026-09-30" },
  "sources": ["hacklist", "hakku", "devpost", "mlh", "luma", "web", "x"]
}
```

#### 3.1.2 Source Collector Agents

Each source collector returns raw leads in a shared format.

Collectors:

- HackList collector
- Hakku collector
- Devpost collector
- MLH collector
- Luma collector
- Web search collector
- X/Twitter MCP collector
- Manual leads collector

Raw lead shape:

```ts
type RawLead = {
  source: string;
  sourceUrl?: string;
  title?: string;
  text?: string;
  links?: string[];
  sourceId?: string;
  discoveredAt: string;
};
```

#### 3.1.3 Extraction Agent

Converts raw leads/page content into `HackathonEventDraft`.

Uses deterministic parsing first. Uses LLM extraction only when fields are missing or messy.

#### 3.1.4 Verification Agent

Checks:

- Is this really a hackathon?
- Is the event upcoming?
- Is the deadline open?
- Is there an official URL?
- Is there an apply/register URL?
- Are location and mode clear?
- Are social leads backed by official sources?

#### 3.1.5 Dedupe Agent

Computes fingerprints and checks existing candidates.

If duplicate:

- update existing candidate with new evidence/fields
- do not create a new candidate

#### 3.1.6 Scoring Agent

Applies scoring rules based on the parsed command and default preferences.

#### 3.1.7 Enrichment Agent

Runs when the user clicks “Find more info” or asks a specific question.

Example questions:

- What is the deadline?
- Is this open to students?
- Is this remote?
- What are the prizes?
- Who is sponsoring it?

## 4. Source Integration Strategy

### 4.1 HackList

Likely a high-signal source. Use fetch/cheerio first. Fall back to Playwright only if needed.

### 4.2 Hakku

Use Playwright because the swipe UI is likely client-rendered.

### 4.3 Devpost

Use search/listing pages where possible. Normalize dates, eligibility, prize, location, tags, and apply URL.

### 4.4 MLH

Use event listings. Normalize date, location, official event page, and mode.

### 4.5 Luma

Use web search and public Luma pages. Luma is a broad events platform, so verification must ensure the lead is actually a hackathon.

### 4.6 Web Search

Use a pluggable search provider interface:

- Tavily
- Brave Search
- Exa
- SerpAPI
- mock provider for local tests

### 4.7 X/Twitter MCP

Use X/Twitter MCP/API as a lead source only. The collector should search posts for hackathon-related terms, extract links, and store post URLs as evidence. Do not use X DMs for approval in MVP.

Example queries:

```text
"hackathon Toronto"
"AI hackathon Canada"
"student hackathon deadline"
"agent hackathon"
"Devpost hackathon"
"MLH hackathon Canada"
```

### 4.8 Instagram and LinkedIn

MVP approach:

- manual lead paste in UI
- Manual Leads sheet tab optional
- web-search leads only
- no logged-in scraping

## 5. Data Flow

### 5.1 Discovery Flow

```text
CLI command
  → parse command
  → build source plan
  → run collectors in parallel with concurrency limit
  → normalize raw leads
  → fetch official pages where needed
  → extract fields
  → verify
  → score
  → dedupe
  → upsert Supabase candidates
  → print run summary
```

### 5.2 Review Flow

```text
Mobile UI loads /queue
  → GET /api/candidates?status=NEW
  → display top candidate card
  → user swipes/taps
  → POST /api/candidates/:id/decision
  → optimistic UI moves to next card
  → if approved, server appends to Google Sheets
```

### 5.3 Enrichment Flow

```text
User taps Find More Info
  → POST /api/candidates/:id/enrich
  → API invokes enrichment agent
  → agent searches official page/web
  → updates candidate fields/evidence
  → saves answer
  → UI displays answer
```

## 6. Latency Strategy

### 6.1 Keep Review Fast

- UI only reads from Supabase.
- Do not scrape during initial queue page load.
- Precompute summaries and scores.
- Use optimistic approve/reject UI.
- Load one card plus next two cards.

### 6.2 Keep Discovery Reasonable

- Run source collectors concurrently with `p-limit`.
- Dedupe raw leads before expensive page fetches.
- Use deterministic parsing before LLM calls.
- Cache page fetches and fingerprints.
- Store partial candidates incrementally.
- Timeout each source independently.

### 6.3 LLM Budget Control

Only call LLM for:

- messy extraction
- ambiguous verification
- enrichment Q&A
- final card summary

Do not call LLM for every field if the page has structured HTML or clear text.

## 7. Free Infrastructure Plan

### 7.1 Supabase

Use Supabase free tier for Postgres, auth if needed, and APIs. Candidate data is small, so this is enough for MVP.

### 7.2 Vercel

Use Vercel Hobby for the mobile web UI. Avoid Playwright in serverless routes. The UI can call Supabase and Google Sheets write APIs through server routes.

### 7.3 Google Sheets

Use Sheets as the final approved tracker. Use a service account and append rows after approval.

### 7.4 Local CLI

Run discovery locally with:

```bash
npm run agent -- "find upcoming hackathons"
```

This keeps browser automation free.

## 8. Security and Secrets

Environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_SHEET_ID
GOOGLE_SERVICE_ACCOUNT_JSON
SEARCH_PROVIDER
SEARCH_API_KEY
X_BEARER_TOKEN
X_MCP_URL
LLM_PROVIDER
LLM_API_KEY
LLM_MODEL
```

Rules:

- Never expose service-role Supabase key in browser.
- Never expose Google service account JSON in browser.
- Approval API routes must run server-side.
- Use RLS before allowing multi-user access.

## 9. Recommended Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase JS client
- Postgres
- Google APIs Node client
- Playwright for local collectors
- Cheerio for static parsing
- Zod for schemas
- Framer Motion or GSAP for swipe animation
- MCP SDK or custom adapter for X/Twitter MCP

## 10. Design/Agent Skill Integration

Use the design skills repository as guidance/context for Cursor when building the UI. Use the GSAP skills repository for gesture and animation guidance if the project chooses GSAP. Keep these as implementation aids, not runtime dependencies unless explicitly needed.

Design principle: the UI should feel like a premium approval deck, not an admin table.
