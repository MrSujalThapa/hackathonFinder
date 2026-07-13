# Discovery terminal

Controlled discovery console at `/terminal`. Not a system shell — never executes OS commands.

## Commands

| Input | Behavior |
|---|---|
| Natural language (e.g. `find AI hackathons in Toronto`) | Starts a discovery job |
| `/find <request>` | Same as natural language |
| `/sources` | Loads source health (`GET /api/sources`) |
| `/status` | Active or latest job status |
| `/history` | Recent jobs from the job store |
| `/cancel` | Cancel the active job |
| `/clear` | Clear console output |
| `/help` | Command help |

Shell-like input (`rm`, `curl`, `npm`, `&&`, pipes, redirection, bare URLs) is rejected with a friendly message.

## API contract (consumed by UI)

Implemented by the discovery job-runtime; the terminal client lives in `src/lib/terminal/api.ts`.

```
POST   /api/discovery/jobs
  body: { command: string, sources?: string[], dryRun?: boolean, maxAgentCalls?: number, mode?, allSources? }
  → { data: { job: DiscoveryJob, execution }, error: null }

GET    /api/discovery/jobs
  → { data: { jobs: DiscoveryJob[], executionMode }, error: null }

GET    /api/discovery/jobs/:id
  → { data: { job: DiscoveryJob }, error: null }

GET    /api/discovery/jobs/:id/events?after=<sequence>
  → text/event-stream (SSE)
  Named events match DiscoveryEvent.type; stream ends with `event: end`.
  JSON uses runId (= job id), sequence, level, source?, message, metadata?

POST   /api/discovery/jobs/:id/cancel
  → { data: { job: DiscoveryJob }, error: null }

GET    /api/sources
  → { data: { sources: SourceHealth[] }, error: null }
```

Event shape:

```json
{
  "id": "evt_…",
  "runId": "…",
  "sequence": 1,
  "timestamp": "ISO-8601",
  "type": "planning_started",
  "level": "info",
  "source": "mlh",
  "message": "Starting…",
  "metadata": {}
}
```

Levels: `info` | `success` | `warning` | `error`.

The UI does not invent progress — it only renders events from the stream.

## Concurrency

Overlapping jobs are queued (not rejected) up to `DISCOVERY_MAX_QUEUED_JOBS`. See [CONCURRENCY.md](./CONCURRENCY.md) for active/queued limits, Hakku profile locking, and queue-position events.

## Auth / middleware (parent integration)

Add `/terminal` to `PROTECTED_PAGE_PREFIXES` in `src/middleware.ts` (`/api/discovery` is already listed). Also protect `/api/sources` if not already.

## Mobile notes

- Full-width console; source rail collapses behind Show/Hide on small screens (always visible ≥ lg)
- Output scrolls independently; input stays anchored above the mobile nav / keyboard
- Primary controls ≥ 44px; no hover-only actions
- Safe-area padding comes from the workspace shell
