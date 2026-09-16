# Production Deployment

HackFinder deploys as three independent processes: the web app, a persistent Discord
gateway, and scheduled one-shot discovery/application workers. A serverless web host
alone is not sufficient for the long-lived Discord gateway. This guide is hosting-vendor neutral.

## 1. Web app

Install with `npm ci`, build with `npm run build`, and serve with `npm run start` on Node 20+
behind HTTPS. Set `APP_BASE_URL` to the public, canonical HTTPS URL; do not use localhost
outside local development. Any Next.js-compatible host is suitable for this process.

## 2. Configure Production Environment

Public browser-safe:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_GOOGLE_SHEET_URL`
- `NEXT_PUBLIC_SENTRY_DSN` optional
- `APP_BASE_URL` (the public HTTPS URL used in notification links and Discord callbacks)

Server-only:

- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_PASSWORD`
- `APP_SESSION_SECRET` (≥ 32 random characters)
- `GOOGLE_SHEET_ID`
- `GOOGLE_SHEET_TAB`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `SEARCH_PROVIDER` / `SEARCH_API_KEY` optional
- `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` optional
- X variables only if explicitly used
- `SENTRY_DSN` optional
- `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` when Discord is enabled

Keep `USE_MOCK_CANDIDATES=false` and `DEMO_MODE=false` in real production.
Use `DEMO_MODE=true` only on a dedicated demo deployment.

Generate session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Validate without printing secrets:

```bash
npm run env:check -- --strict-production
npm run check:prod
```

## 3. Supabase

1. Create a Supabase project.
2. Apply migrations in order under `supabase/migrations/` (`001` … `014`).
3. Confirm the service-role key can read/write candidates from server code.
4. Review and apply `004_production_rls.sql` after confirming API routes use
   service-role access.
5. Create a private Storage bucket named `hackfinder-assets` with a 12 MB file limit.
   Allow the server/service role to read and write it. The application will create the
   bucket on first upload when the service role has Storage administration access, but
   provisioning it explicitly is recommended. Never expose storage keys or local paths
   to the browser; file access is mediated by `/api/asset-bank/file`.

The production RLS migration enables RLS and creates no anon/authenticated
policies for private tables. Direct browser table access is denied; service-role
server code continues to work.

## 4. Google Sheets

1. Enable the Google Sheets API in Google Cloud.
2. Create a service account and JSON key.
3. Share the target Sheet with the service-account email as Editor.
4. Set `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, and `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. Optionally set `NEXT_PUBLIC_GOOGLE_SHEET_URL`.

`GOOGLE_SERVICE_ACCOUNT_JSON` may include `private_key` with `\n` escapes; they
are normalized at parse time.

## 5. Deploy

1. Deploy the web process with the build/start commands above.
2. Open `/api/health`.
4. Expected public response contains only `status`, `version`, `timestamp`, and
   redacted check states.
5. Open `/login`, sign in, and review `/settings`.

## 6. Workers and schedules

Run the Discord gateway as one long-lived, supervised process:

```bash
npm run worker:discord
```

Run these as one-shot scheduled jobs (separate from the web process):

```bash
npm run worker:discovery:once
npm run worker:applications:once
```

Recommended initial cadence is discovery every 6 hours and the application tracker every
15 minutes. Use a managed scheduler, container scheduler, or host cron; ensure only one
instance of a given worker runs at a time. The gateway is not a cron job.

## 7. Local CLI to Production Supabase

Use the same production Supabase URL and service-role key in local `.env.local`.
Discovery remains local:

```bash
npm run agent -- "find upcoming AI hackathons in Canada or remote" -- --agent --sources=hacklist,mlh,web --dry-run
npm run agent -- "find upcoming AI hackathons in Canada or remote" -- --agent --sources=hacklist,mlh,web --max-agent-calls=4
```

Do not run `--sources=x` unless explicitly requested and funded.

## 8. Production Checks

Run locally before deployment:

```bash
npm run env:check
npm run check
npm test
npm run check:supabase
npm run check:sheets
npm run check:llm
npm run check:prod
```

`npm run check:all` runs the non-X production gate.

For a protected browser smoke against a running local or preview deployment, set
`SMOKE_BASE_URL` and `APP_PASSWORD`, then run:

```bash
npm run smoke:prod
```

## 9. Rollback

1. Use Vercel's previous deployment rollback.
2. If a database migration caused issues, pause and inspect before reverting.
3. RLS migration rollback, if needed, is:

```sql
alter table public.candidates disable row level security;
alter table public.candidate_evidence disable row level security;
alter table public.candidate_answers disable row level security;
alter table public.candidate_actions disable row level security;
alter table public.agent_runs disable row level security;
alter table public.manual_leads disable row level security;
```

Only disable RLS temporarily while restoring server-side access.
