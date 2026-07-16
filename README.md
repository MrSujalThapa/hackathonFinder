# Hackathon Finder

Self-hosted workspace that discovers hackathons from public directories, reviews them in a Queue, and optionally syncs approvals to Google Sheets.

Curated UI captures: `artifacts/design/after/` (Queue, login, Settings). Optional demo GIF: add under `docs/images/`.

## What it does

Finding relevant hackathons across Devpost, Luma, HackList, MLH, Hakku, and custom directories is slow. Hackathon Finder turns a natural-language query into a structured discovery run with strict date, location, and remote semantics, then lets you approve, reject, save, or investigate candidates with evidence.

## Key capabilities

- Natural-language Terminal discovery (`light` / `deep` profiles)
- Native adapters for **Devpost** and **Luma**, plus HackList / MLH / Hakku / web search
- **Custom directory adapter** + shared `DirectoryCrawlKernel` for uploaded listing sites
- Listing → triage → enrichment → constraints, then **batch persistence**
- Queue review UI with Ask, history, and restore flows
- Optional explicit Google Sheets sync for approved rows
- Dry-run mode (no candidate writes)
- Deterministic **demo mode** with fixture candidates

## Architecture overview

```text
Terminal / CLI query
  → interpret (dates, location, remote, sources, profile)
  → native adapters (Devpost / Luma / …)
  → custom sources → CustomDirectoryAdapter → DirectoryCrawlKernel
  → normalize / verify / classify / score / dedupe
  → BatchPersistenceStrategy (sole normal writer)
  → Queue review → optional Sheets sync
```

Canonical detail: [`docs/discovery/FINAL_ARCHITECTURE.md`](docs/discovery/FINAL_ARCHITECTURE.md).  
Ops: [`docs/discovery/OPERATIONS_RUNBOOK.md`](docs/discovery/OPERATIONS_RUNBOOK.md).

## Supported sources

| Source | Role |
| --- | --- |
| Devpost | Native directory adapter + API / browser growth |
| Luma | Native multi-feed adapter with theme telemetry |
| HackList / MLH | Directory collectors |
| Hakku | Browser profile collector (owner machine) |
| Web search | Optional provider (`tavily` / `brave` / `exa` / `serpapi` / `mock`) |
| Custom | Generic kernel over uploaded directory URLs |
| X / Twitter MCP | Optional; not required |

**Blocked-source policy:** authenticated or WAF/CAPTCHA-gated pages fail honestly. This project does **not** bypass CAPTCHAs or WAFs. DoraHacks-style blocked hosts remain blocked without retry bypass.

### Custom source scraping

Custom sources use deterministic-first extraction (structured markup → repeated DOM patterns → at most one bounded AI group selection). Crawl plans cache under `.data/crawl-plans/` (local, gitignored, non-authoritative).

## Requirements

- Node.js 20+
- npm 10+
- Supabase project (full mode)
- Playwright Chromium for browser collectors: `npx playwright install chromium`
- Optional: OpenAI-compatible LLM key, search API key, Google service account

## Quick start

```bash
git clone https://github.com/MrSujalThapa/hackathonFinder.git
cd hackathonFinder
npm ci
cp .env.example .env.local
```

### Default local setup (recommended)

Configure owner auth and Supabase (required for Queue persistence and normal UI data). Optional: LLM, search, Sheets.

```bash
# .env.local (minimum)
APP_PASSWORD=change-me
APP_SESSION_SECRET=replace-with-32-plus-random-characters!!
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# Keep DEMO_MODE and USE_MOCK_CANDIDATES unset or false
```

Apply migrations (see Database setup), then:

```bash
npm run env:check
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with `APP_PASSWORD`, open Queue / Terminal.

Discovery dry-runs (`--dry-run`) do not require Supabase writes. Live Terminal discovery needs network access to public sources.

### Optional fixture fallback (not default)

For UI-only exploration without Supabase, you may set `DEMO_MODE=true` or `USE_MOCK_CANDIDATES=true`. This is an **explicit opt-in**, not the recommended path, and must stay off for production and release demos that exercise real Terminal collectors.

## Environment setup

1. Copy `.env.example` → `.env.local`
2. Fill placeholders only — never commit real secrets
3. Run `npm run env:check` (never prints secret values)
4. Optional: `npm run secrets:scan`

**Server-only secrets** (never prefix with `NEXT_PUBLIC_`):

- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_PASSWORD`, `APP_SESSION_SECRET`
- `LLM_API_KEY`, `SEARCH_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `X_BEARER_TOKEN`, `WORKER_SHARED_SECRET`

**Browser-safe:** only `NEXT_PUBLIC_*` values.

Google service-account JSON may embed `private_key` with `\n` escapes; they are normalized when parsed.

Variable inventory: [`docs/ENV_VARIABLES.md`](docs/ENV_VARIABLES.md).

## Database setup

Migrations live in `supabase/migrations/` and must be applied in numeric order (`001` … `010`).

1. Create a Supabase project
2. Apply SQL migrations (Supabase SQL editor or CLI)
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
4. Review `004_production_rls.sql`: RLS is enabled; browser anon access to private tables is denied; server service-role access continues to work

No production data is shipped in this repository. This phase does not alter schema.

## Google Sheets setup (optional)

1. Enable Google Sheets API
2. Create a service account + JSON key
3. Share the spreadsheet with the service-account email (Editor)
4. Set `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, `GOOGLE_SERVICE_ACCOUNT_JSON`
5. Optionally set `NEXT_PUBLIC_GOOGLE_SHEET_URL` for the Open Sheet link

Approve always keeps the candidate `APPROVED` even if Sheets fails. Sync is idempotent by Candidate ID. Demo/mock mode simulates sync and does **not** write to Google.

```bash
npm run check:sheets
npm run sync:sheets -- --dry-run
```

## Running the app

```bash
npm run dev          # development
npm run build && npm run start   # production server
```

Owner login uses `APP_PASSWORD`. Sessions require `APP_SESSION_SECRET` (≥ 32 chars).

Discovery worker (optional):

```bash
npm run worker:discovery
```

## Terminal command examples

Prefer `--profile light` and `--dry-run` while exploring:

```bash
npm run agent -- "find upcoming hackathons in Toronto" -- --profile light --dry-run

npm run agent -- "find upcoming AI hackathons in Toronto or remote in the next 6 months" -- --profile light --dry-run

npm run agent -- "find upcoming hackathons in San Francisco" -- --profile light --dry-run

npm run agent -- "find upcoming hackathons from Reskilll in the next 12 months" -- --profile deep --dry-run

npm run agent -- "find remote AI hackathons in the next 6 months" -- --profile deep --dry-run
```

The same commands work from the in-app Terminal. Deep profiles can take tens of seconds; say so honestly in demos.

Query semantics:

- **Remote** is explicit inclusion (`or remote`), not implied by a city
- Date windows bind event timing / deadlines according to the planner
- Source restrictions (`from Reskilll`) limit collectors

## Testing

```bash
npm run env:check
npm run typecheck
npm test
npm run test:scraper
npm run test:integration
npm run test:deterministic
npm run build
```

Live source probes are manual (see `npm run test:live:sources`). Do not put live network probes in default CI.

## Security / privacy notes

- Self-hosted / single-operator by design
- Secrets stay in `.env.local` (gitignored)
- Dry-run and `DEMO_MODE` do not persist discovery candidates to Supabase
- Custom URLs are fetched only for discovery; blocked pages are not bypassed
- See [`SECURITY.md`](SECURITY.md) and [`docs/PRIVACY.md`](docs/PRIVACY.md)

## Known limitations

- Public source availability, rate limits, and layout changes can degrade collectors
- Hakku requires an owner-managed browser profile
- X/Twitter MCP is optional and unused unless configured
- Demo mode shows fixture Queue data; live Terminal dry-runs still depend on network
- npm audit may report transitive Next/PostCSS advisories until upstream Next ships a fix

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

### Contributors

Primary author: **Sujal Thapa**. Git history currently shows a single committer identity. Third-party skill/license files under `.agents/skills` (and mirrors) retain upstream copyrights.
