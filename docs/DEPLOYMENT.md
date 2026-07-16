# Production Deployment

This guide deploys the review web app. Discovery can run in-process (`DISCOVERY_EXECUTION_MODE=local`)
on a long-lived Node host, or via the worker on serverless hosts.

## 1. Create the Vercel Project

1. Create a Vercel Hobby project.
2. Import the GitHub repository.
3. Use the default Next.js framework preset.
4. Build command: `npm run build`.
5. Install command: `npm ci`.
6. Node.js: 20 or newer.

No `vercel.json` is required for the current app.

## 2. Configure Production Environment

Public browser-safe:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_GOOGLE_SHEET_URL`
- `NEXT_PUBLIC_SENTRY_DSN` optional

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

1. Create a Supabase Free project.
2. Apply migrations in order under `supabase/migrations/` (`001` … `010`).
3. Confirm the service-role key can read/write candidates from server code.
4. Review and apply `004_production_rls.sql` after confirming API routes use
   service-role access.

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

1. Push `main`.
2. Let Vercel build the project.
3. Open `/api/health`.
4. Expected public response contains only `status`, `version`, `timestamp`, and
   redacted check states.
5. Open `/login`, sign in, and review `/settings`.

## 6. Local CLI to Production Supabase

Use the same production Supabase URL and service-role key in local `.env.local`.
Discovery remains local:

```bash
npm run agent -- "find upcoming AI hackathons in Canada or remote" -- --agent --sources=hacklist,mlh,web --dry-run
npm run agent -- "find upcoming AI hackathons in Canada or remote" -- --agent --sources=hacklist,mlh,web --max-agent-calls=4
```

Do not run `--sources=x` unless explicitly requested and funded.

## 7. Production Checks

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

## 8. Rollback

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
