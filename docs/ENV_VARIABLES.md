# Environment variable inventory

Placeholders only. Real values belong in gitignored `.env.local`.

| variable | required | server/client | default | feature | validation | used by |
| --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | implicit | server | `development` | runtime | enum | Next.js, `src/config/env.ts` |
| `APP_URL` | no | server | unset | docs/smoke | URL | optional |
| `APP_PASSWORD` | yes (web) | server | — | owner auth | non-empty | `src/lib/auth/password.ts` |
| `APP_SESSION_SECRET` | yes (web) | server | — | sessions | length ≥ 32 in prod/demo | `src/lib/auth/session.ts` |
| `DEMO_MODE` | no | server | false | demo fixtures | bool; explicit opt-in | `src/config/env.ts`, candidates service, pipeline |
| `USE_MOCK_CANDIDATES` | no | server | false | dev fixtures | bool; blocked in prod unless demo/preview | `src/server/candidates/service.ts` |
| `ALLOW_MOCK_CANDIDATES_IN_PREVIEW` | no | server | false | preview escape | bool | `src/config/env.ts` |
| `NEXT_PUBLIC_SUPABASE_URL` | full mode | client+server | — | Supabase | URL | `src/lib/supabase/*` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | full mode | client+server | — | Supabase | non-empty | `src/lib/supabase/*` |
| `SUPABASE_SERVICE_ROLE_KEY` | full mode | server | — | Supabase writes | non-empty | service client |
| `LLM_PROVIDER` | no | server | unset | enrichment | `openai`\|`mock` | `src/lib/llm/*` |
| `LLM_API_KEY` | if openai | server | — | enrichment | non-empty with provider | `src/lib/llm/*` |
| `LLM_MODEL` | no | server | provider default | enrichment | string | `src/lib/llm/*` |
| `LLM_REQUEST_TIMEOUT_MS` | no | server | provider default | enrichment | positive int | llm config |
| `LLM_MAX_RETRIES` | no | server | — | enrichment | positive int | llm config |
| `LLM_MAX_OUTPUT_TOKENS` | no | server | — | enrichment | positive int | Ask / llm |
| `LLM_MAX_CALLS_PER_RUN` | no | server | — | enrichment | positive int | llm config |
| `LLM_MAX_CALLS_PER_CANDIDATE` | no | server | — | enrichment | positive int | llm config |
| `SEARCH_PROVIDER` | no | server | unset | web search | enum | `src/lib/search/*` |
| `SEARCH_API_KEY` | if non-mock | server | — | web search | non-empty | `src/lib/search/*` |
| `GOOGLE_SHEET_ID` | sheets | server | — | Sheets sync | non-empty | `src/lib/google/*` |
| `GOOGLE_SHEET_TAB` | no | server | `Hackathons` | Sheets sync | string | `src/config/env.ts` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | sheets | server | — | Sheets auth | JSON + email/key | `src/lib/google/config.ts` |
| `NEXT_PUBLIC_GOOGLE_SHEET_URL` | no | client | — | Open Sheet link | URL | `OpenSheetLink` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | unused alias | server | — | docs only | — | not read at runtime |
| `GOOGLE_PRIVATE_KEY` | unused alias | server | — | docs only | — | not read at runtime |
| `GOOGLE_SPREADSHEET_ID` | unused alias | server | — | docs only | — | not read at runtime |
| `GOOGLE_SHEET_NAME` | unused alias | server | — | docs only | — | not read at runtime |
| `DISCOVERY_EXECUTION_MODE` | no | server | `local` | jobs | `local`\|`worker` | `src/discovery/config.ts` |
| `WORKER_SHARED_SECRET` | worker mode | server | — | worker auth | string | discovery config |
| `DISCOVERY_MAX_ACTIVE_JOBS` | no | server | `2` | concurrency | positive int | discovery config |
| `DISCOVERY_MAX_QUEUED_JOBS` | no | server | `10` | concurrency | positive int | discovery config |
| `DISCOVERY_PUBLIC_SOURCE_CONCURRENCY` | no | server | `3` | concurrency | positive int | source locks |
| `DISCOVERY_SOURCE_LOCK_WAIT_MS` | no | server | `60000` | concurrency | positive int | source locks |
| `DISCOVERY_JOB_TIMEOUT_MS` | no | server | `600000` | jobs | positive int | discovery config |
| `DISCOVERY_EVENT_RETENTION_DAYS` | no | server | `14` | cleanup | positive int | discovery config |
| `BROWSER_PROFILE_ROOT` | no | server | `.data/browser-profiles` | Hakku | path | `src/lib/browser/profilePaths.ts` |
| `HAKKU_PROFILE_NAME` | no | server | `hakku` | Hakku | string | profile paths |
| `HAKKU_BROWSER_HEADLESS` | no | server | true-ish | Hakku | bool | collectors |
| `SOURCE_*_ENABLED` | no | server | true | source toggles | bool | `src/lib/sources/config.ts` |
| `PERSISTENCE_ROLLBACK_V1` | no | server | false | emergency | bool; rejected in prod | `src/discovery/persistence/strategies.ts` |
| `PERSISTENCE_BATCH_VERIFY_AFTER_WRITE` | no | server | false | debug | bool | persistence |
| `PERSISTENCE_BATCH_SHADOW` | no | server | false | debug | bool | persistence shadow |
| `X_BEARER_TOKEN` | no | server | — | X MCP | string | `src/lib/x/*` |
| `X_MCP_*` / `X_MAX_*` | no | server | defaults | X MCP | url / positive int | x config |
| `SENTRY_DSN` | no | server | — | errors | URL | optional |
| `NEXT_PUBLIC_SENTRY_DSN` | no | client | — | errors | URL | optional |
| `TERMINAL_SESSION_STORE` | no | server | auto | terminal | `memory`\|`supabase` | `src/server/terminal/store.ts` |
| `TERMINAL_ALLOW_MEMORY_STORE` | no | server | false | terminal | bool | terminal store |
| `DISCOVERY_JOB_STORE` | no | server | auto | jobs | `memory`\|`supabase` | `src/jobs/store.ts` |
| `DISCOVERY_ALLOW_MEMORY_STORE` | no | server | false | jobs | bool | job store |
| `SMOKE_BASE_URL` | no | scripts | localhost | QA scripts | URL | smoke/capture scripts |

### Removed / obsolete (do not use)

| name | note |
| --- | --- |
| `APP_OWNER_PASSWORD_HASH_B64` | Stale docs only; runtime uses `APP_PASSWORD` |
| `APP_OWNER_PASSWORD_HASH` | Stale docs only |
| `OPENAI_API_KEY` | Use `LLM_API_KEY` + `LLM_PROVIDER=openai` |
| `PERSISTENCE_STRATEGY=v1` | Obsolete; batch is unconditional |
| `CUSTOM_SOURCE_ROLLBACK_V1` / shadow flags | Ignored; custom path is kernel-only |

Validate with:

```bash
npm run env:check
npm run check:prod
```
