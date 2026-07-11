# Hackathon Approval Agent

A responsive Tinder-style approval queue for hackathons. A local CLI agent discovers events from HackList, Hakku, Devpost (and later MLH, Luma, web search, X/Twitter). Candidates land in Supabase for review; only approved hackathons will later be appended to Google Sheets.

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

3. Configure Supabase **or** enable explicit mock mode for local UI work:

```bash
# Real database (default when reachable)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Explicit local UI fallback when Supabase is unreachable
USE_MOCK_CANDIDATES=true
```

`USE_MOCK_CANDIDATES` is never enabled silently, and it is forbidden in production.

4. Start the web app:

```bash
npm run dev
```

Open [http://localhost:3000/queue](http://localhost:3000/queue).

## Supabase diagnostics

If writes fail with `TypeError: fetch failed`, diagnose connectivity first:

```bash
npm run check:supabase
```

The script loads `.env.local` from the repo root, prints whether each required variable is set (never prints keys), probes the REST endpoint, and attempts a read-only `candidates` select. Common categories: malformed URL, DNS/network, TLS, invalid API key, paused project, missing table.

## Candidate review controls

| Input | Action |
| --- | --- |
| Approve button / swipe right / → | Approve |
| Reject button / swipe left / ← | Reject |
| Save button / swipe up / `S` | Save for later |
| More details / Enter / Space | Expand or collapse details |
| Escape | Close expanded details |

History routes:

- `/approved`
- `/rejected` (restore supported)
- `/saved` (restore supported)
- `/candidate/[id]`
- `/settings`

Approve currently updates Supabase status only. Google Sheets sync and X/Twitter MCP arrive in later steps.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run check` | Lint + typecheck + build |
| `npm run check:supabase` | Read-only Supabase connectivity diagnostics |
| `npm run test` | Unit / component tests |
| `npm run smoke:queue` | Browser smoke (requires `npm run dev` + mock/live data) |
| `npm run agent -- "<command>"` | Run local discovery agent CLI |

## CLI discovery

```bash
# Real collectors, dry-run (no Supabase required)
npm run agent -- "find upcoming hackathons" -- --dry-run

# Write mode (requires reachable Supabase)
npm run agent -- "find upcoming hackathons" -- --sources=hacklist

# Deterministic fixture collector
npm run agent -- "find upcoming hackathons" -- --sources=mock --dry-run
```

### Dry-run vs write mode

| Mode | Supabase required? | Behavior |
| --- | --- | --- |
| `--dry-run` | No | Parses, collects, scores, and prints what would be stored |
| default (write) | Yes | Upserts accepted candidates + evidence into Supabase |

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

## Project structure

```text
src/
  agent/         # Command parser, controller, run summary
  app/           # Next.js App Router pages + API routes
  cli/           # Local agent entrypoint
  collectors/    # Source collectors (mock, hacklist, hakku, devpost)
  components/    # Approval UI shell, card, queue, history
  config/        # Typed environment validation
  core/          # Dedupe, scoring, extract/verify, discovery types
  hooks/         # Queue + motion hooks
  lib/           # HTTP helpers, Playwright, client API
  server/        # Candidate repository, mock store, API helpers
```

## Development workflow

This repo follows `docs/hackathon_approval_agent_docs/05_PROJECT_PLAN.md`:

1. Foundation
2. Supabase database
3. Agent core
4. Source collectors
5. Approval web UI (current)
6. Google Sheets
7. Enrichment
8. X/Twitter MCP
9. Polish

Run `npm run check` before merging each step branch.

## Docs

Planning docs live in `docs/hackathon_approval_agent_docs/`:

- `01_PRD.md` — product requirements
- `02_SYSTEM_ARCHITECTURE.md` — system design
- `03_API_SPEC.md` — API and CLI contracts
- `04_DATABASE_SCHEMA.md` — Supabase schema
- `05_PROJECT_PLAN.md` — implementation plan
- `07_DESIGN_UX_SPEC.md` — approval UI spec
