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

Run discovery from your machine (collectors wire up in later steps):

```bash
npm run agent -- "find upcoming hackathons"
npm run agent -- "find AI hackathons in Toronto or remote" -- --dry-run
```

## Routes (foundation)

| Route | Purpose |
| --- | --- |
| `/queue` | Approval queue placeholder |
| `/settings` | Settings placeholder |

## Project structure

```text
src/
  app/           # Next.js App Router pages
  cli/           # Local agent entrypoint
  config/        # Typed environment validation
```

## Development workflow

This repo follows a step-by-step plan (`docs/hackathon_approval_agent_docs/05_PROJECT_PLAN.md`):

1. Foundation (current)
2. Supabase database
3. Agent core
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
