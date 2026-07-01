# Project Plan — Hackathon Approval Agent

## Workflow Rules

Use the requested implementation cadence:

1. Work in main steps.
2. Each main step has substeps.
3. Create a feature branch for each main step.
4. Commit after every substep.
5. At the end of each main step, run checks, test manually, then merge the feature branch into `main`.
6. Do not start the next main step until the current step is merged.

Branch naming:

```text
step-01-foundation
step-02-database
step-03-agent-core
step-04-collectors
step-05-approval-ui
step-06-google-sheets
step-07-enrichment
step-08-x-mcp
step-09-polish
```

Commit naming:

```text
feat(scope): short description
fix(scope): short description
docs(scope): short description
test(scope): short description
chore(scope): short description
```

## Step 1 — Foundation

Goal: Create the monorepo/app foundation with TypeScript, Next.js, CLI entrypoint, linting, formatting, and environment validation.

### 1.1 Create Next.js TypeScript app

Tasks:

- Create Next.js App Router project.
- Add TypeScript strict mode.
- Add Tailwind CSS.
- Add base `/queue` route placeholder.
- Add base `/settings` route placeholder.

Commit:

```bash
git add . && git commit -m "feat(app): scaffold nextjs approval ui"
```

### 1.2 Add CLI entrypoint

Tasks:

- Add `src/cli/agent.ts`.
- Add npm script:
  - `npm run agent -- "find upcoming hackathons"`
- CLI should print parsed raw command for now.

Commit:

```bash
git add . && git commit -m "feat(cli): add agent command entrypoint"
```

### 1.3 Add environment validation

Tasks:

- Add `.env.example`.
- Add Zod env validation.
- Support optional variables for X/Search/LLM.
- Required only for features being used.

Commit:

```bash
git add . && git commit -m "feat(config): add typed environment validation"
```

### 1.4 Add project checks

Tasks:

- Add `npm run check`.
- Ensure lint/typecheck/build pass.
- Add README setup section.

Commit:

```bash
git add . && git commit -m "chore(project): add checks and setup docs"
```

### Step 1 merge

```bash
npm run check
git checkout main
git merge --no-ff step-01-foundation
```

## Step 2 — Supabase Database and Data Access

Goal: Create candidate storage with dedupe-safe schema and typed data access.

### 2.1 Add Supabase schema SQL

Tasks:

- Add `supabase/migrations/001_initial_schema.sql`.
- Include candidates, evidence, answers, actions, agent_runs, manual_leads.
- Include indexes and updated_at trigger.

Commit:

```bash
git add . && git commit -m "feat(db): add candidate queue schema"
```

### 2.2 Add Supabase client wrappers

Tasks:

- Add server Supabase client.
- Add browser Supabase client.
- Ensure service role key is server-only.

Commit:

```bash
git add . && git commit -m "feat(db): add supabase client wrappers"
```

### 2.3 Add candidate repository

Tasks:

- Add `src/server/candidates/repository.ts`.
- Implement:
  - listCandidates
  - getCandidate
  - upsertCandidateByFingerprint
  - updateCandidateStatus
  - addEvidence
  - addAction

Commit:

```bash
git add . && git commit -m "feat(candidates): add repository layer"
```

### 2.4 Add dedupe utilities

Tasks:

- Add normalize text/url helpers.
- Add fingerprint generation.
- Add tests for duplicate names/URLs/date combinations.

Commit:

```bash
git add . && git commit -m "feat(dedupe): add candidate fingerprinting"
```

### Step 2 merge

```bash
npm run check
git checkout main
git merge --no-ff step-02-database
```

## Step 3 — Agent Core

Goal: Build the real agent workflow without full collectors yet.

### 3.1 Add shared types and schemas

Tasks:

- Add `RawLead`, `HackathonEvent`, `DiscoveryPreferences`, `ScoringResult`.
- Add Zod schemas.

Commit:

```bash
git add . && git commit -m "feat(agent): add shared discovery schemas"
```

### 3.2 Add command parser

Tasks:

- Parse location, date range, themes, modes, source hints.
- Use deterministic parsing first.
- Optional LLM parser later.

Commit:

```bash
git add . && git commit -m "feat(agent): parse natural language commands"
```

### 3.3 Add scoring engine

Tasks:

- Implement initial scoring rules.
- Return score, whyMatch, redFlags, rejectionReason.
- Add tests.

Commit:

```bash
git add . && git commit -m "feat(agent): add hackathon scoring engine"
```

### 3.4 Add extraction/verification interfaces

Tasks:

- Implement stub deterministic extractor.
- Implement verification interface.
- Add mock source data.

Commit:

```bash
git add . && git commit -m "feat(agent): add extraction and verification pipeline"
```

### 3.5 Wire agent controller

Tasks:

- Controller accepts command.
- Runs mock collector.
- Extracts, scores, dedupes, stores candidates.
- Prints run summary.

Commit:

```bash
git add . && git commit -m "feat(agent): wire controller to candidate queue"
```

### Step 3 merge

```bash
npm run check
npm run agent -- "find upcoming hackathons"
git checkout main
git merge --no-ff step-03-agent-core
```

## Step 4 — Source Collectors

Goal: Add real discovery sources incrementally.

### 4.1 HackList collector

Tasks:

- Fetch HackList.
- Extract visible cards/links.
- Convert to RawLead.
- Add source evidence.

Commit:

```bash
git add . && git commit -m "feat(collectors): add hacklist collector"
```

### 4.2 Hakku collector

Tasks:

- Add Playwright.
- Load Hakku swipe page.
- Extract rendered cards.
- Add timeouts and screenshot/debug option.

Commit:

```bash
git add . && git commit -m "feat(collectors): add hakku playwright collector"
```

### 4.3 Devpost collector

Tasks:

- Fetch/search Devpost hackathon pages.
- Extract title, URL, location/mode, deadlines where possible.

Commit:

```bash
git add . && git commit -m "feat(collectors): add devpost collector"
```

### 4.4 MLH collector

Tasks:

- Fetch MLH event listings.
- Extract upcoming events.

Commit:

```bash
git add . && git commit -m "feat(collectors): add mlh collector"
```

### 4.5 Luma/web search collector

Tasks:

- Add generic search provider abstraction.
- Add Luma-specific query generation.
- Add mock provider fallback.

Commit:

```bash
git add . && git commit -m "feat(collectors): add web and luma search collectors"
```

### Step 4 merge

```bash
npm run check
npm run agent -- "find upcoming hackathons in Toronto or remote"
git checkout main
git merge --no-ff step-04-collectors
```

## Step 5 — Mobile Approval UI

Goal: Build the Tinder-style mobile queue.

### 5.1 Candidate API routes

Tasks:

- Add `GET /api/candidates`.
- Add `GET /api/candidates/[id]`.
- Add `POST /api/candidates/[id]/decision`.

Commit:

```bash
git add . && git commit -m "feat(api): add candidate review endpoints"
```

### 5.2 Queue page layout

Tasks:

- Build dark grid background.
- Build centered card shell.
- Add top image/gradient area.
- Add title/location/summary/date/link rows.
- Add bottom action buttons.

Commit:

```bash
git add . && git commit -m "feat(ui): add mobile approval card layout"
```

### 5.3 Swipe and button interactions

Tasks:

- Add swipe left/right.
- Add reject/approve buttons.
- Add optimistic transition to next card.
- Add undo action placeholder.

Commit:

```bash
git add . && git commit -m "feat(ui): add swipe approval interactions"
```

### 5.4 Detail sheet and history pages

Tasks:

- Tap card opens detail sheet.
- Add `/approved`, `/rejected`, `/saved`.
- Add ability to restore rejected/saved candidate.

Commit:

```bash
git add . && git commit -m "feat(ui): add candidate detail and history views"
```

### Step 5 merge

```bash
npm run check
git checkout main
git merge --no-ff step-05-approval-ui
```

## Step 6 — Google Sheets Integration

Goal: Append approved candidates to Google Sheets.

### 6.1 Add Sheets client

Tasks:

- Add Google service account handling.
- Support `GOOGLE_SERVICE_ACCOUNT_JSON` env var.
- Add append row function.

Commit:

```bash
git add . && git commit -m "feat(sheets): add google sheets append client"
```

### 6.2 Wire approve to Sheets

Tasks:

- Approval route appends to Google Sheets.
- Store `sheet_appended_at` and row metadata if available.
- Handle append failures gracefully.

Commit:

```bash
git add . && git commit -m "feat(sheets): append approved candidates"
```

### 6.3 Add sheet link UI

Tasks:

- Add sheet quick link in top nav/settings.
- Add success/error states after approve.

Commit:

```bash
git add . && git commit -m "feat(ui): add spreadsheet link and sheet status"
```

### Step 6 merge

```bash
npm run check
git checkout main
git merge --no-ff step-06-google-sheets
```

## Step 7 — Enrichment Agent

Goal: User can ask follow-up questions about a candidate.

### 7.1 Add enrichment API

Tasks:

- Add `POST /api/candidates/[id]/enrich`.
- Store question/answer.

Commit:

```bash
git add . && git commit -m "feat(api): add candidate enrichment endpoint"
```

### 7.2 Add enrichment toolchain

Tasks:

- Read existing evidence.
- Fetch official/apply pages.
- Search web if needed.
- Answer concise question.
- Update candidate fields if discovered.

Commit:

```bash
git add . && git commit -m "feat(agent): add candidate enrichment workflow"
```

### 7.3 Add UI ask box

Tasks:

- Detail sheet supports follow-up question input.
- Show answers and sources.
- Add loading state.

Commit:

```bash
git add . && git commit -m "feat(ui): add find more info interaction"
```

### Step 7 merge

```bash
npm run check
git checkout main
git merge --no-ff step-07-enrichment
```

## Step 8 — X/Twitter MCP Collector

Goal: Use X/Twitter MCP/API for lead discovery.

### 8.1 Add X MCP adapter

Tasks:

- Add `src/collectors/xMcp.ts`.
- Use env-gated integration.
- If credentials missing, skip with a clear warning.

Commit:

```bash
git add . && git commit -m "feat(collectors): add x mcp adapter skeleton"
```

### 8.2 Search X for leads

Tasks:

- Generate search queries from preferences.
- Extract post text, post URL, links, username, source ID.
- Store as RawLead and evidence.

Commit:

```bash
git add . && git commit -m "feat(collectors): search x posts for hackathon leads"
```

### 8.3 Verify X leads

Tasks:

- Extract outbound links.
- Find official event page.
- Do not create candidate if only vague social mention exists.
- Store uncertain leads as `NEEDS_REVIEW`.

Commit:

```bash
git add . && git commit -m "feat(agent): verify x leads before candidate creation"
```

### Step 8 merge

```bash
npm run check
npm run agent -- "find AI hackathons from X and web"
git checkout main
git merge --no-ff step-08-x-mcp
```

## Step 9 — Polish, Performance, and Launch

Goal: Make the app feel smooth and usable on phone.

### 9.1 Performance pass

Tasks:

- Preload next two cards.
- Add source timeouts.
- Add collector concurrency limit.
- Add LLM call budget.

Commit:

```bash
git add . && git commit -m "perf(agent): reduce discovery latency and queue load time"
```

### 9.2 Design pass

Tasks:

- Improve card styling based on screenshot.
- Add GSAP or Framer Motion swipe polish.
- Add empty/loading/error states.

Commit:

```bash
git add . && git commit -m "feat(ui): polish mobile swipe experience"
```

### 9.3 Deployment docs

Tasks:

- Add Vercel deployment notes.
- Add Supabase setup notes.
- Add Google service account setup notes.
- Add local CLI setup notes.

Commit:

```bash
git add . && git commit -m "docs(deploy): add free deployment guide"
```

### Step 9 merge

```bash
npm run check
git checkout main
git merge --no-ff step-09-polish
```
