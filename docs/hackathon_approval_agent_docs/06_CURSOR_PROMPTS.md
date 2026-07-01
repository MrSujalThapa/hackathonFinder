# Cursor Prompts — Hackathon Approval Agent

## How to Use These Prompts

Use one prompt per main step. Cursor should implement only that step, commit after every substep, and stop after the step is complete. Do not let it jump ahead.

Before starting:

```bash
git checkout main
git pull
git checkout -b step-01-foundation
```

After every substep, Cursor should run checks if possible and commit.

At the end of a main step, you manually verify, then merge.

---

# Initial Cursor Prompt — Read Docs and Implement Step 1 Only

```text
You are implementing a TypeScript/Next.js project called Hackathon Approval Agent.

Read these docs first and follow them exactly:
- README.md
- 01_PRD.md
- 02_SYSTEM_ARCHITECTURE.md
- 03_API_SPEC.md
- 04_DATABASE_SCHEMA.md
- 05_PROJECT_PLAN.md
- 07_DESIGN_UX_SPEC.md

Important product summary:
This is a mobile-first Tinder-style approval queue for hackathons. A local CLI agent discovers hackathons from HackList, Hakku, Devpost, MLH, Luma, web search, X/Twitter MCP, and manual social leads. It stores candidates in Supabase. The mobile UI lets me approve/reject/save/ask for more info. Only approved candidates are appended to Google Sheets. Rejected and saved candidates are preserved so I can revisit them.

Implementation process:
- Implement Step 1 from 05_PROJECT_PLAN.md only.
- Create/use branch: step-01-foundation.
- Commit after every substep.
- Do not implement database, collectors, Google Sheets, or full UI yet.
- Stop after Step 1 is complete and tell me exactly what changed and what commands to run.

Step 1 requirements:
1. Create a Next.js App Router project with TypeScript strict mode and Tailwind.
2. Add placeholder /queue and /settings routes.
3. Add a CLI entrypoint so this command shape works:
   npm run agent -- "find upcoming hackathons"
   For now, it can print the raw command and a placeholder summary.
4. Add typed environment validation with Zod and .env.example.
5. Add npm scripts for dev, build, lint/typecheck/check.
6. Add README setup instructions.

Quality bar:
- Use clean TypeScript.
- No hardcoded secrets.
- No paid service required.
- Keep structure ready for future Supabase, agent, and UI work.
- Run checks before finishing.

Commit plan:
- feat(app): scaffold nextjs approval ui
- feat(cli): add agent command entrypoint
- feat(config): add typed environment validation
- chore(project): add checks and setup docs
```

---

# Step 2 Prompt — Supabase Database and Data Access

```text
Continue the Hackathon Approval Agent project.

Read:
- 04_DATABASE_SCHEMA.md
- 05_PROJECT_PLAN.md Step 2
- 03_API_SPEC.md relevant data contracts

Implement Step 2 only on branch step-02-database.

Requirements:
1. Add Supabase migration SQL with candidates, candidate_evidence, candidate_answers, candidate_actions, agent_runs, manual_leads, indexes, and updated_at trigger.
2. Add server and browser Supabase client wrappers.
3. Ensure the service role key is server-only and never imported into client components.
4. Add candidate repository functions:
   - listCandidates
   - getCandidate
   - upsertCandidateByFingerprint
   - updateCandidateStatus
   - addEvidence
   - addAction
5. Add dedupe/fingerprint utilities and tests.

Commit after every substep:
- feat(db): add candidate queue schema
- feat(db): add supabase client wrappers
- feat(candidates): add repository layer
- feat(dedupe): add candidate fingerprinting

Do not build collectors or UI interactions yet. Run checks and stop after Step 2.
```

---

# Step 3 Prompt — Agent Core

```text
Continue the Hackathon Approval Agent project.

Implement Step 3 only on branch step-03-agent-core.

Goal:
Build the command-driven agent core using mock collector data before adding real sources.

Requirements:
1. Add shared TypeScript/Zod schemas:
   - RawLead
   - HackathonEvent
   - DiscoveryPreferences
   - ScoringResult
2. Add command parser:
   - locations
   - date range
   - themes
   - modes
   - source hints
3. Add scoring engine based on PRD scoring rules.
4. Add extraction and verification interfaces.
5. Add a mock collector.
6. Wire the CLI agent controller:
   - parse command
   - run mock collector
   - extract event
   - verify
   - score
   - dedupe
   - upsert candidate into Supabase
   - print run summary

Commit after every substep:
- feat(agent): add shared discovery schemas
- feat(agent): parse natural language commands
- feat(agent): add hackathon scoring engine
- feat(agent): add extraction and verification pipeline
- feat(agent): wire controller to candidate queue

Run:
npm run check
npm run agent -- "find upcoming hackathons in Toronto or remote"

Stop after Step 3.
```

---

# Step 4 Prompt — Source Collectors

```text
Continue the Hackathon Approval Agent project.

Implement Step 4 only on branch step-04-collectors.

Goal:
Add real source collectors incrementally.

Sources:
- https://hacklist-omega.vercel.app/
- https://tryhakku.vercel.app/swipe
- Devpost
- MLH
- Luma through web search
- generic web search provider abstraction

Requirements:
1. HackList collector using fetch/cheerio first.
2. Hakku collector using Playwright because it may be client-rendered.
3. Devpost collector.
4. MLH collector.
5. Luma/web search collector with provider abstraction and mock fallback.
6. Each collector must return RawLead[] and never crash the whole agent run.
7. Add per-source timeout and error capture.
8. Add CLI summary by source.

Commit after every substep:
- feat(collectors): add hacklist collector
- feat(collectors): add hakku playwright collector
- feat(collectors): add devpost collector
- feat(collectors): add mlh collector
- feat(collectors): add web and luma search collectors

Run:
npm run check
npm run agent -- "find upcoming hackathons in Toronto or remote"

Stop after Step 4.
```

---

# Step 5 Prompt — Mobile Approval UI

```text
Continue the Hackathon Approval Agent project.

Implement Step 5 only on branch step-05-approval-ui.

Read 07_DESIGN_UX_SPEC.md carefully. The UI should be mobile-first and inspired by the provided Tinder-style dark card screenshot.

Requirements:
1. Add API routes:
   - GET /api/candidates
   - GET /api/candidates/[id]
   - POST /api/candidates/[id]/decision
2. Build /queue page:
   - dark grid background
   - centered vertical card
   - header image/gradient fade
   - status/source pill
   - title, location, summary, date, link
   - approve/reject/save buttons
   - spreadsheet quick link in header/nav
3. Add swipe interactions:
   - right = approve
   - left = reject
   - buttons always work
   - optimistic UI transition
4. Add detail view/sheet when tapping card.
5. Add /approved, /rejected, /saved pages.
6. Rejected and saved candidates must be revisitable and restorable.

Commit after every substep:
- feat(api): add candidate review endpoints
- feat(ui): add mobile approval card layout
- feat(ui): add swipe approval interactions
- feat(ui): add candidate detail and history views

Run checks and stop after Step 5.
```

---

# Step 6 Prompt — Google Sheets Integration

```text
Continue the Hackathon Approval Agent project.

Implement Step 6 only on branch step-06-google-sheets.

Goal:
Append approved candidates to Google Sheets.

Requirements:
1. Add Google Sheets client using a service account.
2. Support GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_SHEET_ID from env.
3. Append only approved candidates to the Hackathons tab.
4. Wire approval route so approve changes status and appends to Sheets.
5. Store sheet metadata on the candidate.
6. If sheet append fails, preserve candidate state and show a clear error.
7. Add sheet quick link in the UI.

Commit after every substep:
- feat(sheets): add google sheets append client
- feat(sheets): append approved candidates
- feat(ui): add spreadsheet link and sheet status

Run checks and stop after Step 6.
```

---

# Step 7 Prompt — Enrichment Agent

```text
Continue the Hackathon Approval Agent project.

Implement Step 7 only on branch step-07-enrichment.

Goal:
Allow me to ask follow-up questions about a candidate.

Requirements:
1. Add POST /api/candidates/[id]/enrich.
2. Add enrichment workflow:
   - read candidate
   - read evidence
   - fetch official/apply pages if needed
   - run web search if needed and configured
   - answer the user's question concisely
   - update candidate fields if new verified info is found
   - store answer in candidate_answers
3. Add UI in detail sheet:
   - question input
   - loading state
   - answer list with sources
4. Common questions:
   - what is the deadline?
   - is this open to students?
   - is this remote?
   - what are the prizes?
   - where is the application link?

Commit after every substep:
- feat(api): add candidate enrichment endpoint
- feat(agent): add candidate enrichment workflow
- feat(ui): add find more info interaction

Run checks and stop after Step 7.
```

---

# Step 8 Prompt — X/Twitter MCP Collector

```text
Continue the Hackathon Approval Agent project.

Implement Step 8 only on branch step-08-x-mcp.

Goal:
Use X/Twitter MCP/API as a lead discovery source. Do not use X DMs. Approvals happen only in the web UI.

Requirements:
1. Add env-gated X MCP collector adapter.
2. If X credentials/MCP URL are missing, skip gracefully and print a clear warning.
3. Generate X search queries from DiscoveryPreferences:
   - hackathon Toronto
   - AI hackathon Canada
   - student hackathon deadline
   - agent hackathon
   - Devpost hackathon
   - MLH hackathon Canada
4. Extract post text, post URL, outbound links, username, and source ID.
5. Store X post as evidence.
6. Verify X leads by finding official event pages before creating candidates.
7. If only vague social evidence exists, create NEEDS_REVIEW or reject with reason.

Commit after every substep:
- feat(collectors): add x mcp adapter skeleton
- feat(collectors): search x posts for hackathon leads
- feat(agent): verify x leads before candidate creation

Run checks and stop after Step 8.
```

---

# Step 9 Prompt — Polish, Performance, Launch

```text
Continue the Hackathon Approval Agent project.

Implement Step 9 only on branch step-09-polish.

Goal:
Make the app feel smooth, low-latency, mobile-ready, and easy to deploy free.

Requirements:
1. Performance:
   - preload next two cards
   - optimistic approve/reject/save UI
   - source timeouts
   - collector concurrency limits
   - LLM call budget
2. Design:
   - polish the card to match the dark Tinder-style screenshot
   - add empty states
   - add loading states
   - add error states
   - add undo affordance
3. Deployment docs:
   - Supabase setup
   - Vercel setup
   - Google service account setup
   - local CLI setup
   - X MCP setup

Commit after every substep:
- perf(agent): reduce discovery latency and queue load time
- feat(ui): polish mobile swipe experience
- docs(deploy): add free deployment guide

Run checks and stop after Step 9.
```
