# C2 — Pipeline performance

**Branch:** `experiment/scraper-overhaul-c2-pipeline-performance`  
**Base:** C1 `c307a2c`  
**Status:** see `C2_PIPELINE_PERFORMANCE_REPORT.md`

## Goals

Reduce discovery event volume, Terminal polling cost, and Queue invalidation waste without changing:

- source recall / routing
- scoring / review gates
- batch-only persistence ownership
- Queue semantics

## Stage budgets

`src/discovery/stageBudgets.ts` — profile guidance only:

| Profile | Listing | Shared enrichment timeout / pages / concurrency |
|---|---|---|
| light | prefer fast | 6s / 8 / 3 |
| standard | balanced | 10s / 15 / 4 |
| deep | full listing targets | 12s / 20 / 4 |
| exhaustive | hard safety limits | 15s / 25 / 4 |

Listing budgets remain **source-owned** (Devpost/Luma collectors). Enrichment never steals listing capacity.

## Event model

Added / emphasized:

- `query_interpreted` — one compact query line
- `source_progress` — coalesced collector chatter
- `result_summary_updated` — aggregate counters (no per-candidate payloads)
- `persistence_completed` — compact persistence summary

Coalescer: `src/discovery/progressCoalescer.ts`  
- min interval 750ms  
- count threshold 8  
- force-flush on completion / blocked / failed phrases  
- first update emits promptly

## Polling

SSE `/api/discovery/jobs/:id/events`:

- cursor via `after` / `Last-Event-ID`
- exponential backoff 500ms → 2.5s when idle
- job refetch only on terminal events or sparse idle ticks
- JSON `?format=json&after=N` returns only new events + compact job

## Terminal invalidation

Completed **dry-run** jobs do **not** call `fetchCandidates` / Queue refresh.  
Real completed runs refresh Queue once.

## In-run enrichment cache

`enrichPromisingLeads` dedupes identical enrichment target URLs within a run.

## Probe

```bash
npx tsx scripts/c2-pipeline-performance-probe.ts
npx tsx scripts/c2-pipeline-performance-probe.ts --quick
```

Traces: `.local-audits/traces/c2-pipeline-performance/`
