# Hackathon Finder

An agent-powered discovery and approval workflow for finding worthwhile hackathons without manually searching dozens of event platforms.

Hackathon Finder collects events from multiple sources, normalizes and scores them, removes duplicates, and sends the strongest candidates into a swipe-style review queue. Approved events can then be synced to Google Sheets for planning and collaboration.

## What it does

1. Accepts a natural-language search request.
2. Searches configured hackathon sources.
3. Extracts and normalizes event information.
4. Deduplicates overlapping listings.
5. Scores candidates for relevance and confidence.
6. Stores accepted candidates in Supabase.
7. Presents them in a responsive review interface.
8. Syncs approved events to Google Sheets.

```text
Natural-language request
          ↓
   Source collectors
          ↓
Extract → verify → normalize
          ↓
 Deduplicate and score
          ↓
     Supabase queue
          ↓
 Approve / reject / save
          ↓
     Google Sheets
```

## Core features

- **Multi-source discovery** across HackList, MLH, Luma, web search, Devpost, and Hakku
- **Natural-language commands** for location, date range, theme, and event preferences
- **Agentic extraction pipeline** that collects, enriches, verifies, scores, and filters candidates
- **Cross-run deduplication** to prevent repeated events from flooding the queue
- **Responsive review deck** with swipe gestures and keyboard controls
- **Approval history** for approved, rejected, and saved candidates
- **Restoration workflow** for returning rejected or saved events to the queue
- **Idempotent Google Sheets sync** with retry and partial-failure recovery
- **Owner authentication** for deployed instances
- **Source and integration diagnostics** for Supabase, Google Sheets, search, and LLM configuration
- **Mock and dry-run modes** for deterministic local development

## Review controls

| Input | Action |
| --- | --- |
| Swipe right, click Approve, or press `→` | Approve and attempt Google Sheets sync |
| Swipe left, click Reject, or press `←` | Reject |
| Swipe up, click Save, or press `S` | Save for later |
| `Enter` or `Space` | Expand or collapse details |
| `Escape` | Close expanded details |

## Tech stack

| Layer | Technology |
| --- | --- |
| Web application | Next.js 15, React 19, TypeScript |
| Styling and motion | Tailwind CSS, GSAP |
| Database | Supabase / PostgreSQL |
| Browser collection | Playwright |
| HTML extraction | Cheerio |
| Validation | Zod |
| Export | Google Sheets API |
| Testing | Node test runner, Testing Library, Happy DOM, JSDOM |

## Project structure

```text
src/
├── agent/          # Command parsing, orchestration, and run summaries
├── app/            # Next.js pages and API routes
├── cli/            # Discovery and Sheets synchronization commands
├── collectors/     # Platform-specific source collectors
├── components/     # Queue, cards, history, and status UI
├── config/         # Typed environment configuration
├── core/           # Extraction, verification, scoring, merge, and dedupe logic
├── crawl/          # Crawling and browser-assisted collection primitives
├── discovery/      # Discovery workflows and source coordination
├── hooks/          # Queue state and interaction hooks
├── jobs/           # Background job logic
├── lib/            # Shared clients and infrastructure helpers
└── server/         # Persistence, API helpers, and Sheets synchronization

worker/             # Discovery worker entrypoint
scripts/            # Diagnostics, probes, smoke tests, and maintenance tools
supabase/           # Database migrations and Supabase configuration
docs/               # Architecture, product, deployment, and release documentation
```

## Getting started

### Prerequisites

- Node.js 20+
- npm 10+
- A Supabase project for live persistence
- Playwright Chromium for browser-assisted collectors
- Optional Google Cloud service account for Sheets sync
- Optional search-provider and LLM credentials

### 1. Install the project

```bash
git clone https://github.com/MrSujalThapa/hackathonFinder.git
cd hackathonFinder
npm install
npx playwright install chromium
```

### 2. Configure the environment

```bash
cp .env.example .env.local
```

Configure the values required by the features you intend to run.

```bash
# Browser-safe Supabase configuration
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Server-side Supabase access
SUPABASE_SERVICE_ROLE_KEY=...

# Google Sheets integration
GOOGLE_SHEET_ID=...
GOOGLE_SHEET_TAB=Hackathons
GOOGLE_SERVICE_ACCOUNT_JSON=...
NEXT_PUBLIC_GOOGLE_SHEET_URL=...

# Search integration
SEARCH_PROVIDER=...
SEARCH_API_KEY=...

# Optional LLM integration
LLM_PROVIDER=openai
LLM_API_KEY=...
LLM_MODEL=...
```

Never commit `.env.local`, service-account files, access tokens, or private keys.

### 3. Configure owner access

Generate a password hash:

```bash
npm run hash:password -- "your-long-password"
```

Add the generated `APP_OWNER_PASSWORD_HASH_B64` value and a random session secret to `.env.local`:

```bash
APP_OWNER_PASSWORD_HASH_B64=...
APP_SESSION_SECRET=... # At least 32 random characters
```

Verify the password before deployment:

```bash
npm run verify:password -- "your-long-password"
```

### 4. Apply the database migrations

Run the migrations in `supabase/migrations/` against your Supabase project.

The application persists candidates, evidence, answers, actions, agent runs, and manual leads in PostgreSQL.

### 5. Start the application

```bash
npm run dev
```

Open `http://localhost:3000/queue`.

## Run the discovery agent

The CLI accepts natural-language discovery requests.

```bash
npm run agent -- "find upcoming hackathons" -- --dry-run
```

A more targeted search:

```bash
npm run agent -- \
  "find AI and agent hackathons in Toronto, Waterloo, Canada, or remote from 2026-07-01 to 2026-12-31" \
  -- --sources=hacklist,mlh,luma,web
```

Use selected sources only:

```bash
npm run agent -- "find AI hackathons in Toronto" \
  -- --sources=mlh,luma,web --dry-run
```

Inspect the web-search plan without collecting:

```bash
npm run agent -- "find AI hackathons in Toronto" \
  -- --sources=web --show-search-plan --dry-run-plan
```

Run deterministic fixtures without database writes:

```bash
npm run agent -- "find upcoming hackathons" \
  -- --sources=mock --dry-run
```

### Dry-run and write behavior

| Mode | Supabase required | Behavior |
| --- | --- | --- |
| `--dry-run` | No | Runs collection, extraction, scoring, and filtering without persistence |
| Default write mode | Yes | Upserts accepted candidates and supporting evidence |
| Mock source in write mode | Yes | Blocked unless mock writes are explicitly enabled |

The CLI loads `.env.local` automatically.

## Google Sheets integration

Approved candidates can be appended to a configured Google Sheet.

To configure it:

1. Enable the Google Sheets API in a Google Cloud project.
2. Create a service account and JSON key.
3. Create a spreadsheet and a tab such as `Hackathons`.
4. Share the spreadsheet with the service-account email as an editor.
5. Add the spreadsheet, tab, credential, and public URL values to `.env.local`.

Verify connectivity without writing:

```bash
npm run check:sheets
```

Recover approved candidates that have not been synchronized:

```bash
npm run sync:sheets -- --dry-run
npm run sync:sheets -- --limit=50
```

Synchronization is idempotent. Candidate IDs are checked before appending, so retries do not create duplicate rows. If a Sheet append succeeds but the Supabase metadata update fails, a later retry can recover the existing row.

## Application routes

| Route | Purpose |
| --- | --- |
| `/queue` | One-at-a-time review deck |
| `/approved` | Approved candidates and Sheets sync state |
| `/rejected` | Rejected candidates with restoration controls |
| `/saved` | Saved-for-later candidates |
| `/candidate/[id]` | Full candidate details and evidence |
| `/settings` | Integration and configuration status |

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm run start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript checks |
| `npm run test` | Run the fast test suite |
| `npm run test:integration` | Run integration tests |
| `npm run test:deterministic` | Run all deterministic tests |
| `npm run check` | Run lint, typecheck, and build |
| `npm run check:all` | Run the complete non-X production gate |
| `npm run check:supabase` | Diagnose Supabase connectivity |
| `npm run check:sheets` | Diagnose Google Sheets connectivity |
| `npm run check:llm` | Diagnose the configured LLM provider |
| `npm run check:sources` | Check collector configuration and availability |
| `npm run check:prod` | Validate production-critical configuration |
| `npm run smoke:queue` | Run the queue browser smoke test |
| `npm run smoke:prod` | Run the deployed owner-auth smoke test |
| `npm run worker:discovery` | Start the discovery worker |
| `npm run worker:discovery:once` | Run one worker iteration |

## Mock data safety

Set mock mode explicitly when Supabase is unavailable:

```bash
USE_MOCK_CANDIDATES=true
```

Mock mode is never enabled silently and must not be used in production.

With `USE_MOCK_CANDIDATES=false`, database rows whose `source` value is `mock` are still real Supabase records left by an earlier run. Audit those records before deleting anything:

```bash
npm run candidates:audit-sources
```

The agent refuses to persist mock-sourced candidates into a live database unless mock writes are explicitly allowed.

## Diagnostics

When a dependency is not working, use the repository's read-only checks before changing code:

```bash
npm run check:supabase
npm run check:sheets
npm run check:llm
npm run check:sources
npm run check:prod
```

These commands validate configuration and connectivity without printing secrets.

## Documentation

Additional technical documentation lives in `docs/`, including:

- Product requirements
- System architecture
- API and CLI contracts
- Database schema
- UX specifications
- Deployment guidance
- Release and validation procedures

## License

No license has been added yet. Until one is provided, the repository remains fully copyrighted by its owner.
