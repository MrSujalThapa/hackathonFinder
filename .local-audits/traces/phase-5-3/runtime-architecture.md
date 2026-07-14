# Phase 5.3 Adaptive Page Understanding Runtime Architecture

Date: 2026-07-14
Branch: `experiment/phase-5-3-adaptive-page-understanding`
Base: `cb9fc36e77885a29ded678cdb2a2811b0eaad295`

Scope: experiment-only Scraper V2 adaptive crawler. This design does not modify V1/native collectors, production queueing, persistence, scoring, classification, dedupe, deployment, or source settings. V2 output remains non-persistent and local-audit only.

## Principles

- Hackfinder-owned extraction, validation, identity, date/status filtering, normalization, and coverage classification remain deterministic.
- Runtime profiles change real depth, action, request, source, deadline, and checkpoint behavior.
- Network and browser work use async I/O. Worker threads are not used unless profiling later proves a CPU-bound bottleneck.
- Static HTTP, browser sources, detail-page validation, AI/vision inference, and result processing are isolated bulkheads with bounded queues.
- One slow, blocked, or noisy source cannot block other sources or already-valid progressive results.
- Browser crawling uses one shared browser process, isolated context per source, bounded pages per context, per-host concurrency, deadline propagation, retries with jitter for transient failures only, and source-local circuit breakers.
- No hostname-specific parsers, selectors, endpoints, JSON paths, or pagination rules.
- AI/vision are bounded advisory layers. They propose declarative choices only; deterministic validation accepts or rejects every proposal.

## Stage 1: Request Intent

Input:

```ts
type AdaptiveCrawlIntentInput = {
  query: string;
  requestedCount?: number;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  latencyPreference?: "fast" | "balanced" | "coverage";
};
```

Output:

```ts
type AdaptiveCrawlIntent = {
  normalizedQuery: string;
  requestedCount?: number;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  prioritizeLatency: boolean;
  prioritizeCoverage: boolean;
};
```

Runtime contract:

- Timeout: 50 ms deterministic parsing.
- Cancellation: pre/post synchronous checks.
- Concurrency: in-process CPU only.
- Failures: `invalid_intent`, `unsupported_horizon`, `cancelled`.
- Metrics: parse time, count terms, horizon terms, latency/coverage terms.
- Idempotency: same input produces same normalized intent.
- Side effects: none.

## Stage 2: Crawl Plan

Input: `AdaptiveCrawlIntent`

Output:

```ts
type CrawlProfile = "light" | "standard" | "deep" | "exhaustive";

type CrawlPlan = {
  profile: CrawlProfile;
  targetValidEvents: number;
  maxRawRecords: number;
  maxSources: number;
  maxPagesPerSource: number;
  maxRequestsPerSource: number;
  maxBrowserActionsPerSource: number;
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
- Failures: `invalid_plan`, `bounded_by_safety_limit`, `cancelled`.
- Metrics: profile, requested target, source/page/request/action caps, horizon span.
- Idempotency: same intent yields same plan.
- Side effects: none.

Profile behavior:

- Light: target 25-50 valid events, highest-yield sources first, shallow pagination, fastest time to first useful batch.
- Standard: target 100-150 valid events, moderate source/page depth, balanced latency and coverage.
- Deep: target 500+ valid events across sources when available, deeper pagination, all relevant sources, checkpoints and progressive batches.
- Exhaustive: crawl until public source exhaustion or hard safety caps; never claim complete when source total is unknown.

## Stage 3: Source Scheduling

Input:

```ts
type SourceSchedulingInput = {
  plan: CrawlPlan;
  manifests: SourceExperiment[];
  yieldHistory: SourceYieldEstimate[];
  seenGlobalIdentities: Set<string>;
};
```

Output:

```ts
type ScheduledSource = {
  sourceId: string;
  experiment: SourceExperiment;
  priority: number;
  expectedMode: "structured" | "static_dom" | "browser" | "unknown";
  hostLimitKey: string;
  budgetShare: CrawlPlan;
  reason: string;
};
```

Runtime contract:

- Timeout: 100 ms for local manifests and cached yield data.
- Cancellation: checked before enqueueing each source.
- Concurrency: scheduler only; execution goes through bulkheads.
- Failures: `no_sources`, `unsafe_origin`, `manifest_invalid`, `cancelled`.
- Metrics: queued sources, source priority distribution, expected mode distribution, per-host queued work.
- Idempotency: stable source/profile/horizon scheduling key.
- Side effects: enqueue into experiment runtime queues only.

Scheduling rules:

- Light: prefer high valid-events/sec, low browser cost, low failure rate.
- Deep/exhaustive: include all relevant sources and reallocate additional page/action budget to sources still producing unique valid identities.
- Source count and event count are tracked separately.
- Native collectors remain preferred where they outperform generic V2; this engine only evaluates V2 suitability.

## Stage 4: Acquisition

Input: `ScheduledSource`, cancellation signal, per-source deadline.

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

- Timeout: bounded by profile and per-source deadline slices.
- Cancellation: propagated to fetch, queue wait, browser navigation, browser actions, and response listeners.
- Concurrency: static HTTP bulkhead, browser source bulkhead, per-host limiter.
- Failures: `timeout`, `rate_limited`, `blocked`, `network_transient`, `unsafe_redirect`, `payload_too_large`, `browser_unavailable`, `cancelled`.
- Metrics: requests, bytes, redirects, status classes, browser pages, browser actions, retries, time to first artifact.
- Idempotency: request/action URLs and cursor/action fingerprints dedupe within source.
- Side effects: in-memory artifacts plus optional ignored checkpoint writes for deep/exhaustive only.

## Stage 5: Page Understanding

Input: acquired artifacts plus current source state.

Output:

```ts
type PageUnderstanding = {
  candidateGroups: CandidateEventGroup[];
  fieldCandidates: CandidateFieldMap[];
  identityCandidates: EventIdentityCandidate[];
  actionCandidates: CandidateAction[];
  observations: {
    structuredRecords: number;
    domUnits: number;
    accessibilityNodes: number;
    iframeDocuments: number;
    shadowRoots: number;
    virtualizedGrowthSignals: number;
    modalSignals: number;
  };
  failures: ClassifiedFailure[];
};
```

Runtime contract:

- Timeout: target under 5 s per page shape, profile-bounded.
- Cancellation: checked per artifact, DOM unit, iframe, shadow root, and action enumeration pass.
- Concurrency: source task plus result-processing bulkhead for heavy summaries.
- Failures: `no_artifacts`, `no_candidate_groups`, `dom_unreadable`, `iframe_inaccessible`, `shadow_unavailable`, `virtualized_no_growth`, `cancelled`.
- Metrics: group count, field coverage, identity coverage, group confidence, accessibility node count, iframe/shadow counts, modal candidates.
- Idempotency: page-shape fingerprint, DOM node IDs, action IDs, group IDs.
- Side effects: none.

Observation sources:

- Structured and network JSON.
- Repeated DOM units.
- Accessibility roles/names.
- Same-origin iframe documents.
- Open shadow DOM.
- Layout and bounding boxes.
- Scroll/virtualized growth measurements.
- Modal/detail behavior.

## Stage 6: Extraction

Input: `PageUnderstanding`, existing structured and DOM extraction helpers.

Output:

```ts
type ExtractedEventSet = {
  sourceId: string;
  groupId: string;
  recordsObserved: number;
  rawRecords: unknown[];
  leads: GenericShadowLead[];
  schema?: InferredEventSchema | DomExtractionSchema;
  identityConfidence: number;
  extractionFailures: ClassifiedFailure[];
};
```

Runtime contract:

- Timeout: 500 ms per 200 normalized records target, profile-bounded.
- Cancellation: checked per candidate group and normalization batch.
- Concurrency: source task only unless profiling proves CPU-bound.
- Failures: `record_set_not_discovered`, `schema_mapping_failed`, `identity_missing`, `normalization_empty`, `date_parse_failed`, `cancelled`.
- Metrics: raw records, normalized leads, valid candidates, identity method distribution.
- Idempotency: identity hashes dedupe source-local and global sets.
- Side effects: none.

Identity order:

1. unique event URL;
2. structured ID;
3. stable slug/data attribute;
4. lower-confidence composite hash of title + date + location.

Cards without detail URLs can still produce lower-confidence event identities.

## Stage 7: Event Validation

Input: extracted event sets, optional bounded detail samples.

Output:

```ts
type ValidatedEventBatch = {
  sourceId: string;
  leads: GenericShadowLead[];
  rejected: RejectedRecordSummary[];
  precisionEstimate: number;
  duplicateRate: number;
  dateCoverage: DateCoverageSummary;
  quality: ExtractionQualityReport;
};
```

Runtime contract:

- Timeout: deterministic validation under 500 ms plus bounded detail-page validation pool when enabled.
- Cancellation: checked before detail validation and between samples.
- Concurrency: detail-page validation bulkhead with per-host limit.
- Failures: `non_event_set`, `identity_unstable`, `schema_untrusted`, `detail_validation_failed`, `low_precision`, `cancelled`.
- Metrics: valid/open/in-horizon/expired counts, sampled precision, duplicates, rejection stages.
- Idempotency: deterministic validation over same artifacts and detail samples.
- Side effects: none.

## Stage 8: Adaptive Navigation

Input: source state, page understanding, validation batch, crawl plan, source deadline.

Output:

```ts
type NavigationDecision = {
  action?: CandidateAction;
  stopReason:
    | "target_and_horizon_satisfied"
    | "source_exhausted"
    | "no_new_identities"
    | "repeated_fingerprint"
    | "expired_or_irrelevant_streak"
    | "page_cap"
    | "request_cap"
    | "action_cap"
    | "deadline"
    | "circuit_open"
    | "cancelled";
  expectedEffect?: "next_page" | "numbered_page" | "load_more" | "infinite_scroll" | "open_detail" | "close_modal";
  confidence: number;
};
```

Runtime contract:

- Timeout: decision under 100 ms; action execution bounded by source deadline slice.
- Cancellation: propagated to queue wait, click, scroll, modal close, navigation, and response capture.
- Concurrency: browser action bulkhead and per-host limiter.
- Failures: `action_failed`, `unsafe_action`, `unrelated_navigation`, `no_growth`, `quality_regressed`, `cancelled`.
- Metrics: actions discovered/executed/accepted/rejected, new identities per action, fingerprints, quality delta, date coverage delta.
- Idempotency: action IDs and fingerprints prevent repeats.
- Side effects: ignored checkpoint writes for deep/exhaustive.

Supported generic actions:

- next page;
- numbered page;
- load more;
- infinite scroll;
- open event detail/modal;
- close modal and continue.

## Stage 9: Progressive Result Batches

Input: validated batches, source metrics, global crawl state.

Output:

```ts
type ProgressiveResultBatch = {
  batchId: string;
  sequence: number;
  sourceId: string;
  leads: GenericShadowLead[];
  metrics: SourceYieldMetrics;
  targetProgress: {
    validEvents: number;
    openRegistrationEvents: number;
    inHorizonEvents: number;
    duplicatesRemoved: number;
  };
  persistenceDisabled: true;
};
```

Runtime contract:

- Timeout: enqueue under 50 ms after useful batch.
- Cancellation: terminal batch reports cancellation when possible.
- Concurrency: bounded result-processing bulkhead with backpressure.
- Failures: `queue_full`, `batch_duplicate`, `cancelled`.
- Metrics: time to first 10, time to first 50, time to target, batch count, queue wait.
- Idempotency: stable batch ID from source/profile/horizon/page/action sequence.
- Side effects: no production persistence.

## Stage 10: Checkpoint/Resume

Input: source state, crawl plan, date horizon, seen identities, latest stop reason.

Output:

```ts
type AdaptiveCrawlCheckpoint = {
  sourceId: string;
  sourceUrl: string;
  profile: CrawlProfile;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  pageFingerprint: string;
  paginationState?: unknown;
  actionState?: unknown;
  seenIdentityHashes: string[];
  pagesCompleted: number;
  recordsObserved: number;
  dateCoverage: DateCoverageSummary;
  stopReason?: string;
  updatedAt: string;
};
```

Runtime contract:

- Timeout: save under 50 ms per checkpoint.
- Cancellation: checkpoint best-effort on terminal cancellation.
- Concurrency: result-processing bulkhead only.
- Failures: `checkpoint_read_failed`, `checkpoint_write_failed`, `checkpoint_invalid`, `cancelled`.
- Metrics: checkpoint loaded/saved/skipped, resume page/action, duplicate identities avoided.
- Idempotency: key by source URL + profile + date horizon.
- Side effects: ignored local experiment storage only.

## Stage 11: Final Coverage Report

Input: all source metrics, progressive batches, final stop states.

Output:

```ts
type FinalCoverageReport = {
  profile: CrawlProfile;
  requestedTarget: number;
  rawRecords: number;
  validEvents: number;
  openRegistrationEvents: number;
  inHorizonEvents: number;
  duplicatesRemoved: number;
  estimatedAvailableEvents?: number;
  estimatedRecall?: number;
  sampledPrecision: number;
  timeToFirst10Ms?: number;
  timeToFirst50Ms?: number;
  timeToTargetMs?: number;
  totalDurationMs: number;
  sourceReports: SourceCoverageReport[];
  productRequirementMet: boolean;
};
```

Runtime contract:

- Timeout: 250 ms after crawl completion.
- Cancellation: emit partial terminal report when possible.
- Concurrency: no pool.
- Failures: `report_incomplete`, `metrics_missing`, `cancelled`.
- Metrics: all final aggregate and per-source counters.
- Idempotency: report is deterministic from captured batches/metrics.
- Side effects: ignored local audit file only.

## Date-Horizon Continuation

Per source tracks earliest/latest event date, earliest/latest deadline, open-registration count, closed/expired count, in-horizon count, and page-to-page date progression.

Continue when:

- valid-event target is not met;
- requested date horizon is not covered;
- later pages continue yielding useful open events;
- budget remains.

Stop when:

- target and date coverage are sufficient;
- source is exhausted;
- no new identities appear;
- page/cursor repeats;
- multiple pages contain only expired or irrelevant records;
- source deadline or safety cap is reached.

Reports separate raw records, valid events, open-registration events, and in-horizon events.

## AI/Vision Gate

AI is allowed only when deterministic logic cannot confidently select event groups, distinguish events from navigation/editorial/forms, map fields, or choose among safe actions.

Limits:

- max one AI call per unresolved page shape;
- no per-event calls;
- no automatic calls on healthy sources;
- sanitized bounded input only;
- output limited to candidate ID, classification, declarative field mapping, selected action ID, and confidence.

Vision is allowed only when meaningful cards are visible but DOM grouping fails. Vision proposals must map back to real DOM nodes and exact DOM/network values. Vision cannot invent events, URLs, fields, or actions.

## Required Phase 5.3 Gate

The product requirement is met only if live evidence shows:

- at least one zero-result site becomes usable;
- one interactive source completes at least two validated generic actions with new stable identities after each action;
- light/standard/deep profiles execute materially different crawl depths;
- date horizons alter continuation and stopping behavior;
- deep checkpoint/resume avoids restart and duplicate results;
- sampled precision is at least 90% for accepted recovered results;
- coverage is honest;
- Devpost, MLH, Devfolio, Eventbrite, and Garage48 do not regress;
- no named-site extraction logic is added.

If any gate fails, the custom engine must be reported as not yet meeting the product requirement.
