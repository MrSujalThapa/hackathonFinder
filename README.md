# Hackathon Approval Agent

A mobile-first Tinder-style approval queue for hackathons. A local CLI agent discovers events from HackList, Hakku, Devpost, MLH, Luma, web search, X/Twitter, and manual leads. Candidates land in Supabase for review; only approved hackathons are appended to Google Sheets.

## Prerequisites

- Node.js 20+
- npm 10+

No paid services are required for the foundation step. Supabase, Google Sheets, search, and LLM integrations are optional until those features are enabled.

## Setup

1. Clone the repository and install dependencies:

```bash
npm install
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
| `npm run agent -- "<command>"` | Run local discovery agent CLI |

## CLI

Run the local discovery agent from your machine. Step 3 uses a **mock collector** with deterministic parsing, extraction, verification, scoring, and Supabase upserts.

```bash
# Dry-run (no Supabase required) — prints parsed preferences and discovery summary
npm run agent -- "find upcoming hackathons" -- --dry-run

# Natural-language examples
npm run agent -- "find upcoming hackathons"
npm run agent -- "/find hackathons in Toronto"
npm run agent -- "search hackathons in Toronto from 2026-07-01 to 2026-08-31"
npm run agent -- "find AI agent hackathons remote or near Waterloo"
```

### Dry-run vs write mode

| Mode | Supabase required? | Behavior |
| --- | --- | --- |
| `--dry-run` | No | Parses, scores, and prints what would be stored |
| default (write) | Yes | Upserts accepted candidates + evidence into Supabase |

For write mode, configure these in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The CLI loads `.env.local` automatically before running.

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
  collectors/    # Source collectors (mock in Step 3)
  config/        # Typed environment validation
  core/          # Dedupe, scoring, extract/verify, discovery types
  server/        # Supabase repositories and agent run helpers
```

## Development workflow

This repo follows a step-by-step plan (`docs/hackathon_approval_agent_docs/05_PROJECT_PLAN.md`):

1. Foundation
2. Supabase database
3. Agent core (current)
4. Source collectors
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
