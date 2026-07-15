# Phase 5 Adaptive Crawl Runtime Architecture

Date: 2026-07-14
Branch: `experiment/phase-5-adaptive-crawl-engine`
Base: `18a0a1bb62f53d93c37eb31724734999829bd652`

Scope: experiment-only Scraper V2 adaptive, high-coverage generic scraping. This design does not integrate V2 into production, persist V2 output, change V1 collectors, or introduce hostname-specific extraction logic.

## Principles

- Scraper V2 remains an experiment-only pipeline under `src/experiments/scraper-v2`.
- Each stage has typed inputs and outputs, bounded time, explicit cancellation, classified failures, metrics, and no hidden side effects.
- Network and browser work uses async I/O concurrency rather than worker threads.
- Static HTTP, API pagination, browser actions, detail-page validation, and AI inference use separate bounded pools.
- Per-host limits apply across pools so one origin cannot monopolize the run.
- Results are emitted progressively and deep runs checkpoint locally in ignored experiment storage.
- AI is a bounded planner/semantic judge only; it never executes browser code or performs per-record scraping.

## Staged Pipeline

### 1. Request Intent

Input:

```ts
type CrawlIntentInput = {
  query: string;
  requestedCount?: number;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  latencyPreference?: "fast" | "balanced" | "coverage";
};
```

Output:

```ts
type CrawlIntent = {
  normalizedQuery: string;
  targetCountHint?: number;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  prioritizeLatency: boolean;
  prioritizeCoverage: boolean;
};
```

Runtime contract:

- Timeout: 50 ms deterministic parsing, excluding any upstream agent planning.
- Cancellation: synchronous cancellation check before returning.
- Concurrency: in-process CPU only, no pool.
- Failure classification: `invalid_intent`, `unsupported_horizon`, `cancelled`.
- Metrics: parse time, profile terms matched, horizon terms matched.
- Side effects: none.

### 2. Discovery Budget

Input: `CrawlIntent`

Output:

```ts
type DiscoveryBudget = {
  profile: "quick" | "standard" | "deep" | "exhaustive";
  targetAcceptedEvents: number;
  maxRawRecords: number;
  maxSources: number;
  maxPagesPerSource: number;
  maxRequestsPerSource: number;
  maxDetailPagesPerSource: number;
  maxDurationMs: number;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  prioritizeLatency: boolean;
  prioritizeCoverage: boolean;
};
```

Runtime contract:

- Timeout: 25 ms.
- Cancellation: deterministic pre/post checks.
- Concurrency: no pool.
- Failure classification: `invalid_budget`, `bounded_by_safety_limit`, `cancelled`.
- Metrics: selected profile, requested count, raw cap, page cap, request cap.
- Side effects: none.

### 3. Source Scheduling

Input: candidate source manifests, `DiscoveryBudget`, historical source-yield metrics.

Output:

```ts
type SourceScheduleItem = {
  sourceUrl: string;
  allowedOrigins: string[];
  budgetShare: DiscoveryBudget;
  priority: number;
  expectedMode: "structured" | "static_dom" | "browser" | "unknown";
  hostLimitKey: string;
};
```

Runtime contract:

- Timeout: 100 ms for local manifests and cached metrics.
- Cancellation: checked before queueing each source.
- Concurrency: queue scheduler only; execution happens in pools.
- Failure classification: `no_sources`, `unsafe_origin`, `cancelled`.
- Metrics: source count, priority distribution, expected modes, per-host queued work.
- Side effects: enqueue only into the experiment scheduler state.

### 4. Acquisition

Input: `SourceScheduleItem`, cancellation signal, source deadline.

Output:

```ts
type AcquisitionEnvelope = {
  artifacts: AcquiredArtifact[];
  diagnostics: AcquisitionDiagnostics;
  failures: ClassifiedFailure[];
  metrics: SourceAcquisitionMetrics;
};
```

Runtime contract:

- Timeout: quick 2-5 s, standard 8 s, deep/exhaustive per-page deadline slices up to the source deadline.
- Cancellation: propagated to fetch, browser navigation, and queue wait.
- Concurrency: static HTTP pool, API pagination pool, browser pool.
- Failure classification: `timeout`, `rate_limited`, `blocked`, `network_transient`, `unsafe_redirect`, `payload_too_large`, `cancelled`.
- Metrics: requests, bytes, browser pages, response classes, time to first artifact.
- Side effects: none beyond local in-memory artifacts and optional ignored checkpoints.

### 5. Structured Extraction

Input: acquired JSON/framework/API artifacts.

Output: candidate record sets, inferred schema proposals, normalized leads, extraction metrics.

Runtime contract:

- Timeout: structured source under 2 s target.
- Cancellation: checked per artifact and array scan.
- Concurrency: CPU-bound slices within source task; no worker thread.
- Failure classification: `no_record_arrays`, `schema_rejected`, `low_precision`, `cancelled`.
- Metrics: arrays scanned, records inspected, selected record set, raw/valid/open/in-horizon counts.
- Side effects: none.

### 6. DOM Inference

Input: HTML or DOM snapshot artifacts.

Output: DOM representation, repeated unit sets, selected declarative DOM schema, normalized leads.

Runtime contract:

- Timeout: deterministic DOM source under 5 s target.
- Cancellation: checked per representation and unit set.
- Concurrency: source task only.
- Failure classification: `no_dom_artifact`, `no_unit_set`, `schema_rejected`, `low_identity`, `cancelled`.
- Metrics: node count, unit sets, selected units, title/url/date coverage, duplicate rate.
- Side effects: none.

### 7. Event-Intent Validation

Input: candidate record sets, DOM unit sets, normalized leads, optional bounded detail samples.

Output:

```ts
type EventIntentValidation = {
  eventIntentScore: number;
  identityScore: number;
  schemaTrustScore: number;
  classification: "healthy" | "usable" | "ambiguous" | "rejected";
  reasons: string[];
};
```

Runtime contract:

- Timeout: 500 ms deterministic validation plus bounded detail-page validation budget when enabled.
- Cancellation: checked before detail validation and between samples.
- Concurrency: detail-page validation pool.
- Failure classification: `non_event_set`, `identity_unstable`, `schema_untrusted`, `detail_validation_failed`, `cancelled`.
- Metrics: positive/negative signal counts, identity uniqueness, reused listing URLs, noisy title rate.
- Side effects: none.

### 8. AI-Assisted Decision

Input: up to 5 candidate sets, up to 10 sanitized sample records per set, safe headings/text/link patterns, field candidates, validator reasons.

Output: strict declarative proposal containing classification, selected record set, field mapping, pagination/action hint, confidence, and short reasoning summary.

Runtime contract:

- Timeout: 8 s hard cap.
- Cancellation: abort provider request when supported; otherwise ignore late result.
- Concurrency: AI inference pool with per-host/page-shape dedupe.
- Failure classification: `not_needed`, `no_plausible_sets`, `timeout`, `schema_invalid`, `unsafe_proposal`, `low_confidence`, `cancelled`.
- Metrics: call count, latency, token estimate, accepted/rejected proposal counts.
- Side effects: none. AI output is applied only through deterministic validation.

### 9. Adaptive Pagination

Input: current source state, validated schema, current records, `DiscoveryBudget`, candidate browser/API/static actions.

Output: next acquisition/action decision, stop reason, updated source state.

Runtime contract:

- Timeout: decision under 100 ms, action bounded by source deadline slice.
- Cancellation: propagated to action execution and source queues.
- Concurrency: API pagination pool or browser action pool.
- Failure classification: `source_exhausted`, `no_growth`, `repeated_fingerprint`, `expired_streak`, `irrelevant_streak`, `action_failed`, `budget_exhausted`, `cancelled`.
- Metrics: pages completed, requests, new identities, duplicate rate, date progression, accepted/page.
- Side effects: ignored local checkpoint writes for deep/exhaustive runs only.

### 10. Normalization

Input: accepted structured or DOM records with validated schema.

Output: `GenericShadowLead[]` plus raw, valid, open-registration, and in-horizon counts.

Runtime contract:

- Timeout: bounded per batch, target under 500 ms for 200 records.
- Cancellation: checked per batch.
- Concurrency: source task only.
- Failure classification: `normalization_empty`, `date_parse_failed`, `identity_missing`, `cancelled`.
- Metrics: normalized count, valid event count, open count, in-horizon count, duplicate count.
- Side effects: none.

### 11. Progressive Result Batches

Input: normalized, validated leads and source metrics.

Output:

```ts
type ProgressiveResultBatch = {
  batchId: string;
  sourceUrl: string;
  sequence: number;
  leads: GenericShadowLead[];
  metrics: SourceYieldMetrics;
  stopReason?: string;
  persistenceDisabled: true;
};
```

Runtime contract:

- Timeout: emit under 50 ms after each useful batch.
- Cancellation: terminal batch reports cancellation if possible.
- Concurrency: bounded result queue with backpressure.
- Failure classification: `queue_full`, `cancelled`.
- Metrics: time to first useful result, time to first 10/50, batches emitted.
- Side effects: no production persistence.

## Concurrency Pools

```ts
type CrawlPools = {
  staticHttp: { concurrency: 8; perHost: 2 };
  apiPagination: { concurrency: 6; perHost: 2 };
  browserSources: { concurrency: 2; perHost: 1; pagesPerContext: 2 };
  detailValidation: { concurrency: 6; perHost: 2 };
  aiInference: { concurrency: 1; perHost: 1 };
};
```

- Static and API pools share host accounting.
- Browser work uses one shared browser process, one isolated browser context per source, and bounded pages per context.
- Browser failures open a source-local circuit breaker and do not block static/API sources.
- AI pool is isolated so slow inference cannot block deterministic extraction.

## Browser Action Loop

The generic browser loop uses declarative actions only:

```ts
type CandidateAction = {
  elementId: string;
  role?: string;
  accessibleName?: string;
  href?: string;
  disabled: boolean;
  context: "pagination" | "listing" | "filter" | "detail" | "navigation" | "unknown";
  proposedEffect:
    | "next_page"
    | "load_more"
    | "infinite_scroll"
    | "change_sort"
    | "change_filter"
    | "open_detail"
    | "unknown";
  confidence: number;
};
```

Loop:

1. Observe DOM, accessibility/action candidates, record fingerprints, scroll state, and safe network activity.
2. Choose a high-confidence deterministic action, or use one bounded AI ranking call for an unresolved page shape.
3. Execute one approved action.
4. Verify fingerprint changed, stable identities grew, event quality remained high, and date coverage or useful record count improved.
5. Stop on repeated failed actions, no growth, timeout, budget exhaustion, unrelated navigation, or source circuit breaker.

## Date Coverage Stop Conditions

Per source, track:

- earliest/latest event dates
- earliest/latest deadlines
- open-registration rate
- expired/closed rate
- in-horizon count
- page-to-page date progression

Continue while accepted target is not met, the requested horizon is not covered, useful open events are still appearing, a safe next page/action exists, and budget remains.

Stop when accepted results plus horizon coverage are sufficient, the source is exhausted, no stable identities grow, fingerprints repeat, expired/irrelevant streak bounds are hit, or timeout/rate/caps fire.

## Deep Crawl Checkpoints

Ignored local experiment storage contains:

```ts
type CrawlCheckpoint = {
  sourceUrl: string;
  pageFingerprint: string;
  paginationState?: unknown;
  seenIdentityHashes: string[];
  pagesCompleted: number;
  recordsObserved: number;
  dateCoverage: DateCoverageSummary;
  updatedAt: string;
};
```

Checkpoints are written after bounded page batches, keyed by stable source/profile/horizon idempotency keys, and loaded only by experiment CLI/runtime code. They do not use migrations or production persistence.

## Adapter Cache

The local ignored adapter cache stores validated declarative schemas and page fingerprints. A cached schema is reused only after fingerprint verification and sample validation. It is invalidated when fingerprint drift, title/URL completeness loss, duplicate-rate growth, validation failures, or pagination identity loss are observed.
