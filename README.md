# Hackathon Approval Agent

A responsive Tinder-style approval queue for hackathons. A local CLI agent discovers events from HackList, Hakku, Devpost (and later MLH, Luma, web search, X/Twitter). Candidates land in Supabase for review; approved hackathons sync idempotently to Google Sheets.

## Prerequisites

- Node.js 20+
- npm 10+
- Playwright Chromium (for Hakku/Devpost fallback and optional UI smoke): `npx playwright install chromium`

## Setup

1. Clone the repository and install dependencies:

```bash
npm install
npx playwright install chromium
```

2. Copy the environment template:

```bash
cp .env.example .env.local
```

3. Configure environment variables.

Public browser-safe values:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_GOOGLE_SHEET_URL=...
```

Server-only values:

```bash
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_SHEET_ID=...
GOOGLE_SHEET_TAB=Hackathons
GOOGLE_SERVICE_ACCOUNT_JSON=...
SEARCH_PROVIDER=...
SEARCH_API_KEY=...
LLM_PROVIDER=openai
LLM_API_KEY=...
LLM_MODEL=gpt-4o-mini
```

Owner-only web access:

```bash
npm run hash:password -- "your-long-password"
# paste the printed APP_OWNER_PASSWORD_HASH_B64=... line into .env.local
npm run verify:password -- "your-long-password"
APP_SESSION_SECRET=... # 32+ random chars
```

Optional local UI fallback when Supabase is unreachable:

```bash
USE_MOCK_CANDIDATES=true
```

`USE_MOCK_CANDIDATES` is never enabled silently, and it is forbidden in production. For live queue + Sheets testing use `USE_MOCK_CANDIDATES=false`.

`USE_MOCK_CANDIDATES=false` never uses the in-memory mock store, but the UI may still show database rows with `source='mock'` left over from earlier agent runs. Those are live Supabase rows, not mock-mode fixtures. Do **not** auto-delete them — identify and clean up intentionally:

```sql
SELECT id, name, status, source, official_url
FROM candidates
WHERE source = 'mock';
```

Read-only audit (counts by source + lists mock rows):

```bash
npm run candidates:audit-sources
```

The agent refuses to upsert mock-sourced candidates into Supabase while `USE_MOCK_CANDIDATES=false` unless you pass `--allow-mock-writes` (or use `--dry-run`).

4. Configure Google Sheets (required for approval → Sheet sync):

```bash
GOOGLE_SHEET_ID=
GOOGLE_SHEET_TAB=Hackathons
GOOGLE_SERVICE_ACCOUNT_JSON=
NEXT_PUBLIC_GOOGLE_SHEET_URL=
```

5. Start the web app:

```bash
npm run dev
```

Open [http://localhost:3000/queue](http://localhost:3000/queue).

## Google Sheets setup (manual)

1. Create or select a Google Cloud project.
2. Enable the **Google Sheets API**.
3. Create a **service account**.
4. Create a JSON key and copy the **complete JSON** into `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env.local` (as a single-line string is fine; escaped `\n` in `private_key` is handled).
5. Create a Google Spreadsheet.
6. Create a tab named `Hackathons` (or set `GOOGLE_SHEET_TAB`).
7. Share the Sheet with the service-account email as **Editor**.
8. Copy the spreadsheet ID into `GOOGLE_SHEET_ID`.
9. Copy the full browser URL into `NEXT_PUBLIC_GOOGLE_SHEET_URL` (used by the Open Sheet link).

Never commit `.env.local`, service-account JSON files, or private keys.

Verify read-only connectivity:

```bash
npm run check:sheets
```

Validate deployment-critical configuration without printing secrets:

```bash
npm run check:prod
```

Recover approved-but-unsynced candidates (idempotent):

```bash
npm run sync:sheets -- --dry-run
npm run sync:sheets -- --limit=50
```

### Idempotency and partial failure

- Approving always keeps the candidate `APPROVED`, even if Sheets fails.
- Sync looks up the **Candidate ID** column before appending, so retries do not create duplicate rows.
- If append succeeds but Supabase `sheet_row_id` / `sheet_appended_at` update fails, the next retry finds the existing row and recovers metadata (`recovered_existing_row`).
- Mock mode (`USE_MOCK_CANDIDATES=true`) records a labeled mock sync and does **not** write to Google Sheets.

## Supabase diagnostics

If writes fail with `TypeError: fetch failed`, diagnose connectivity first:

```bash
npm run check:supabase
```

The script loads `.env.local` from the repo root, prints whether each required variable is set (never prints keys), probes the REST endpoint, and attempts a read-only `candidates` select. Common categories: malformed URL, DNS/network, TLS, invalid API key, paused project, missing table.

## Candidate review controls

| Input | Action |
| --- | --- |
| Approve button / swipe right / → | Approve (+ attempt Sheet sync) |
| Reject button / swipe left / ← | Reject |
| Save button / swipe up / `S` | Save for later |
| More details / Enter / Space | Expand or collapse details |
| Escape | Close expanded details |

History routes:

- `/approved` — sync badges + Retry Sync when needed
- `/rejected` (restore supported)
- `/saved` (restore supported)
- `/candidate/[id]` — sheet row/range, sync timestamp, retry
- `/settings` — Sheets config status + Open Sheet link

X/Twitter MCP arrives in a later project step.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run check` | Lint + typecheck + build |
| `npm run check:all` | Full non-X production gate |
| `npm run check:supabase` | Read-only Supabase connectivity diagnostics |
| `npm run check:llm` | Live/mock LLM connectivity diagnostics |
| `npm run check:sheets` | Read-only Google Sheets diagnostics (no writes) |
| `npm run check:prod` | Production environment validation (no live writes) |
| `npm run candidates:audit-sources` | Read-only audit of candidate `source` values (lists `source='mock'`) |
| `npm run sync:sheets` | Idempotent recovery for approved unsynced candidates |
| `npm run test` | Unit / component tests |
| `npm run smoke:queue` | Browser smoke (requires `npm run dev` + mock/live data) |
| `npm run smoke:prod` | Owner-login smoke for a running local/preview deployment |
| `npm run agent -- "<command>"` | Run local discovery agent CLI |

Opt-in live Sheets integration tests (not part of default CI):

```bash
RUN_GOOGLE_SHEETS_INTEGRATION=true npm test -- src/server/sheets/sheets.integration.test.ts
```

## CLI discovery

Default sources: `hacklist`, `mlh`, `luma`, `web`. Devpost and Hakku remain available when requested; `mock` only when explicit.

```bash
# Real collectors, dry-run (no Supabase required)
npm run agent -- "find upcoming hackathons" -- --dry-run

# Broader discovery dry-run
npm run agent -- "find upcoming hackathons" -- --sources=mlh,luma,web --dry-run

# Write mode with broader sources (requires reachable Supabase)
npm run agent -- "find AI and agent hackathons in Toronto, Waterloo, Canada, or remote from 2026-07-01 to 2026-12-31" -- --sources=hacklist,mlh,luma,web

# Show planned web-search queries without collecting
npm run agent -- "find AI hackathons in Toronto" -- --sources=web --show-search-plan --dry-run-plan

# Deterministic fixture collector (dry-run; no DB writes)
npm run agent -- "find upcoming hackathons" -- --sources=mock --dry-run

# Explicit override only (writes source=mock into live Supabase)
npm run agent -- "find upcoming hackathons" -- --sources=mock --allow-mock-writes
```

Web search requires `SEARCH_PROVIDER` and `SEARCH_API_KEY` in `.env.local` (provider `mock` needs no key). If unset, the web collector warns and other sources continue.
### Dry-run vs write mode

| Mode | Supabase required? | Behavior |
| --- | --- | --- |
| `--dry-run` | No | Parses, collects, scores, and prints what would be stored |
| default (write) | Yes | Upserts accepted candidates + evidence into Supabase |
| write + `source=mock` | Yes | Refused unless `USE_MOCK_CANDIDATES=true` or `--allow-mock-writes` |

The CLI loads `.env.local` automatically before running.

## Routes

| Route | Purpose |
| --- | --- |
| `/queue` | One-at-a-time review deck |
| `/approved` | Approved history |
| `/rejected` | Rejected history (restorable) |
| `/saved` | Saved-for-later history |
| `/candidate/[id]` | Full candidate detail |
| `/settings` | Connection / integration status |

## API notes (Sheets)

| Endpoint | Behavior |
| --- | --- |
| `POST /api/candidates/[id]/approve` | Marks APPROVED, then best-effort Sheet sync; returns `sheetSync` |
| `POST /api/candidates/[id]/sync-sheet` | Idempotent retry for APPROVED candidates |
| `POST /api/sheets/sync-approved` | Batch recovery (`limit` required/ capped) |

## Project structure

```text
src/
  agent/         # Command parser, controller, run summary
  app/           # Next.js App Router pages + API routes
  cli/           # Local agent + sync:sheets entrypoints
  collectors/    # Source collectors (mock, hacklist, hakku, devpost, mlh, luma, web)
  components/    # Approval UI shell, card, queue, history, sheet badges
  config/        # Typed environment validation
  core/          # Dedupe, merge, enrich, scoring, extract/verify, discovery types
  hooks/         # Queue + motion hooks
  lib/           # HTTP helpers, Playwright, search providers, Google Sheets client
  server/        # Candidate repository, sheets sync, API helpers
```

## Development workflow

This repo follows `docs/hackathon_approval_agent_docs/05_PROJECT_PLAN.md`:

1. Foundation
2. Supabase database
3. Agent core
4. Source collectors
5. Approval web UI
6. Google Sheets (current)
7. Enrichment
8. X/Twitter MCP
9. Polish

Run `npm run check` before merging each step branch.

## Docs

Planning docs live in `docs/hackathon_approval_agent_docs/`:

- `docs/DEPLOYMENT.md` — free/near-free production deployment guide
- `01_PRD.md` — product requirements
- `02_SYSTEM_ARCHITECTURE.md` — system design
- `03_API_SPEC.md` — API and CLI contracts
- `04_DATABASE_SCHEMA.md` — Supabase schema
- `05_PROJECT_PLAN.md` — implementation plan
- `07_DESIGN_UX_SPEC.md` — approval UI spec
