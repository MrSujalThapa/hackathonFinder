# Hackathon Approval Agent

A mobile-first Tinder-style approval queue for hackathons. A local CLI agent discovers events from HackList, Hakku, Devpost, MLH, Luma, web search, X/Twitter, and manual leads. Candidates land in Supabase for review; only approved hackathons are appended to Google Sheets.

## Prerequisites

- Node.js 20+
- npm 10+
- Playwright Chromium (for Hakku and Devpost fallback): `npx playwright install chromium`

No paid services are required for the foundation step. Supabase, Google Sheets, search, and LLM integrations are optional until those features are enabled.

## Setup

1. Clone the repository and install dependencies:

```bash
npm install
npx playwright install chromium
```

2. Copy the environment template and fill in values only for features you plan to use:

```bash
cp .env.example .env.local
```

All variables are optional during early development. See `.env.example` for Supabase, Google Sheets, search, X/Twitter MCP, and LLM settings.

3. Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app redirects to `/queue`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check (`strict` mode) |
| `npm run check` | Lint + typecheck + build |
| `npm run test` | Unit tests |
| `npm run agent -- "<command>"` | Run local discovery agent CLI |

## CLI

Run the local discovery agent from your machine. Step 4 adds **real collectors** for HackList, Devpost, and Hakku, while keeping the mock collector for deterministic testing.

```bash
# Real collectors, dry-run (no Supabase required)
npm run agent -- "find upcoming hackathons" -- --dry-run

# Explicit real sources
npm run agent -- "find upcoming hackathons" -- --sources=hacklist,devpost,hakku --dry-run

# Mock mode for deterministic local testing
npm run agent -- "find upcoming hackathons" -- --sources=mock --dry-run

# Limit raw leads per source
npm run agent -- "find upcoming hackathons" -- --sources=hacklist,devpost,hakku --max-results=20 --dry-run

# Natural-language examples
npm run agent -- "find upcoming AI hackathons in Toronto or remote"
npm run agent -- "/find hackathons in Toronto"
npm run agent -- "search hackathons in Toronto from 2026-07-01 to 2026-08-31"
npm run agent -- "find AI agent hackathons remote or near Waterloo"
```

### Dry-run vs write mode

| Mode | Supabase required? | Behavior |
| --- | --- | --- |
| `--dry-run` | No | Parses, collects, scores, and prints what would be stored |
| default (write) | Yes | Upserts accepted candidates + evidence into Supabase |

For write mode, configure these in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The CLI loads `.env.local` automatically before running.

### Source defaults (Step 4)

| Flag | Default |
| --- | --- |
| `--sources` | `hacklist,devpost,hakku` |
| `--max-results` | `25` |

Use `--sources=mock` when you want the deterministic Step 3 fixture data.

### Known limitations (Step 4)

- HackList/Devpost HTML selectors can change; collectors emit warnings instead of crashing.
- Hakku is client-rendered and currently login-gated; the collector warns and continues without leads.
- Devpost listing pages may require Playwright when static HTML has no cards.
- MLH, Luma, web search, X/Twitter MCP, Google Sheets, and approval UI are not implemented yet.

## Routes (foundation)

| Route | Purpose |
| --- | --- |
| `/queue` | Approval queue placeholder |
| `/settings` | Settings placeholder |

## Project structure

```text
src/
  agent/         # Command parser, controller, run summary
  app/           # Next.js App Router pages
  cli/           # Local agent entrypoint
  collectors/    # Source collectors (mock, hacklist, hakku, devpost)
  config/        # Typed environment validation
  core/          # Dedupe, scoring, extract/verify, discovery types
  lib/           # HTTP fetch helpers and Playwright wrapper
  server/        # Supabase repositories and agent run helpers
```

## Development workflow

This repo follows a step-by-step plan (`docs/hackathon_approval_agent_docs/05_PROJECT_PLAN.md`):

1. Foundation
2. Supabase database
3. Agent core
4. Source collectors (current)
5. Mobile approval UI
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
- `07_DESIGN_UX_SPEC.md` — mobile UI spec
