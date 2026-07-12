# Production Deployment

This phase keeps discovery as a local CLI workflow and deploys only the review
web app. That avoids always-on workers and keeps Playwright/browser collectors
out of Vercel serverless routes.

## 1. Create the Vercel Project

1. Create a Vercel Hobby project.
2. Import the GitHub repository.
3. Use the default Next.js framework preset.
4. Build command: `npm run build`.
5. Install command: `npm install`.
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
- `APP_OWNER_PASSWORD_HASH`
- `APP_SESSION_SECRET`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SHEET_TAB`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `SEARCH_PROVIDER`
- `SEARCH_API_KEY`
- `LLM_PROVIDER`
- `LLM_API_KEY`
- `LLM_MODEL`
- X variables only if funded and explicitly used later
- `SENTRY_DSN` optional

Keep `USE_MOCK_CANDIDATES=false` in production.

Generate owner auth:

```bash
npm run hash:password -- "your-long-owner-password"
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Use the first output for `APP_OWNER_PASSWORD_HASH` and the second for
`APP_SESSION_SECRET`.

## 3. Supabase

1. Create a Supabase Free project.
2. Apply existing migrations in order:
   - `001_initial_schema.sql`
   - `002_sheet_delete_action.sql`
   - `003_agent_run_metadata.sql`
3. Confirm the local CLI can write candidates with the service-role key.
4. Review `004_production_rls.sql`.
5. Apply `004_production_rls.sql` manually after confirming the deployed web app
   uses Next.js API routes and server-side service-role access.

The production RLS migration enables RLS and creates no anon/authenticated
policies for private tables. Direct browser table access is denied; service-role
server code continues to work.

## 4. Google Sheets

1. Enable the Google Sheets API in Google Cloud.
2. Create a service account and JSON key.
3. Share the target Sheet with the service-account email as Editor.
4. Set `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, and `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. Set `NEXT_PUBLIC_GOOGLE_SHEET_URL` for the Open Sheet link.

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

Do not run `--sources=x` until X credits are funded.

## 7. Production Checks

Run locally before deployment:

```bash
npm run check
npm test
npm run check:supabase
npm run check:sheets
npm run check:llm
npm run check:prod
```

`npm run check:all` runs the non-X production gate.

For a protected browser smoke against a running local or preview deployment, set
`SMOKE_BASE_URL` and `SMOKE_OWNER_PASSWORD`, then run:

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
