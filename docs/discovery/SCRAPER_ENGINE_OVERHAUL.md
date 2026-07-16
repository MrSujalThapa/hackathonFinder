  # Scraper Engine Overhaul (Revised)

  **Status:** approved through **A0** (complete — see [`A0_INVENTORY_TELEMETRY.md`](./A0_INVENTORY_TELEMETRY.md)). Later phases still gated.  
  **Goal:** simplify production scraping to **one growth loop + adapters + existing discovery pipeline**, not add Scraper V3 beside V1/V2.

  Canonical copy in-repo. Cursor also keeps a mirror under `.cursor/plans/`.

  ---

  ## Final recommendation

  **Proceed**, with the revised staged gates below.

  Reject a “big-bang kernel rewrite.” Proceed only if every subphase has an entry/exit gate and B4/C4 deletions require measured soak. If stakeholders cannot accept a multi-week parity window, **revise further** toward A-only (Devpost/Luma recall) and defer kernel extraction.

  ### Phase checklist

  - [x] A0 — Inventory and telemetry truth *(interpretation corrected: 166 ≠ full directory)*
  - [x] A1 — Devpost full-directory acquisition + listing-before-detail *(see FULL_DIRECTORY_RECALL.md; product: light 50–100, deep ≥300)*
  - [x] A2 — Luma collect-first multi-route *(see FULL_DIRECTORY_RECALL.md; deep ≥100 unique provisional)*
  - [x] B1 — Kernel extraction, no behavior change *(see B1_KERNEL_EXTRACTION.md / B1_PARITY_REPORT.md)*
  - [x] B2 — Custom sources → kernel *(see B2_CUSTOM_KERNEL.md)*
  - [x] B4 — Remove obsolete paths
  - [ ] C1 — Batch-only persistence
  - [ ] C2 — Pipeline / event payload optimization
  - [ ] C3 — Test/archive cleanup
  - [ ] C4 — Final soak and rollback removal

  ---

  ## 1. Revised architecture

  ```mermaid
  flowchart TD
    Prefs[DiscoveryPreferences] --> Pipeline[executeDiscoveryPipeline]
    Pipeline --> Collectors[Collectors and adapters]
    Collectors --> Kernel[DirectoryCrawlKernel]
    Kernel --> Listing[Listing RawLeads plus inventory]
    Listing --> Triage[Cheap candidate triage]
    Triage --> Detail[Authoritative detail enrichment]
    Detail --> Reconcile[Evidence reconciliation]
    Reconcile --> Constraints[Hard query constraints]
    Constraints --> Score[Classify score verify]
    Score --> Batch[Batch persistence only]
  ```

  **Ownership rule:** kernel never imports scoring, persistence, Devpost/Luma parsers, or query filters. Adapters never own global scheduling. Pipeline never owns scroll/API growth loops.

  ---

  ## 2. Kernel boundary and TypeScript interfaces

  ### Kernel owns

  - acquisition lifecycle
  - growth execution (invoke adapter-supplied steps)
  - crawl budgets and deadlines
  - stable identity accumulation
  - no-growth / repeat detection
  - stop reasons
  - source inventory metrics
  - compact progress events

  ### Adapters own

  - API response parsing
  - DOM/card parsing
  - date semantics
  - auth/session behavior
  - canonical URL construction

  ### Pipeline owns

  - query relevance
  - location/remote constraints
  - authoritative detail enrichment
  - evidence reconciliation
  - classification / scoring / verification
  - persistence

  ### Interfaces (contract sketch)

  ```ts
  // src/crawl/types.ts (proposed)

  type CrawlMechanism = "api" | "scroll" | "next" | "static";

  type CrawlStopReason =
    | "exhausted"
    | "no_growth"
    | "max_budget"
    | "timeout"
    | "blocked_human_verification"
    | "blocked_authentication"
    | "cancelled"
    | "acquisition_failed";

type InventoryEstimateMethod =
  | "api_total"
  | "pagination_derived"
  | "scroll_plateau"
  | "unknown";

/** Never expose an estimated total without method + confidence. */
type InventoryEstimate = {
  value: number;
  method: InventoryEstimateMethod;
  confidence: "strong" | "moderate" | "weak";
};

type SourceInventoryMetrics = {
  observed?: InventoryEstimate;
  collectedRaw: number;
  collectedUnique: number;
  // queryRelevant is NOT filled by the kernel
};

type CrawlBudget = {
  maxDurationMs: number;
  maxRequests: number;
  maxPagesOrScrolls: number;
  maxBrowserActions: number;
  maxPayloadBytes: number;
  minReservedUnits?: number;       // guaranteed floor for this run
  maxExtensionUnits?: number;      // one-shot extension when yield positive
};

type StableIdentity = string;

/** Bounded listing evidence — never an open-ended raw blob. */
type ListingEvidence = {
  snippet?: string;                // ≤ 280 chars
  visibleDateText?: string;        // ≤ 80 chars
  visibleLocationText?: string;    // ≤ 120 chars
  sourceFieldKeys?: string[];      // ≤ 16 short keys from API/DOM
};

type ListingCard = {
  identity: StableIdentity;
  title: string;
  url?: string;
  // listing-time optional fields only — never require detail fields here
  startDate?: string;
  endDate?: string;
  locationText?: string;
  modeHint?: "remote" | "in_person" | "hybrid" | "unknown";
  evidence?: ListingEvidence;
};

type GrowthStepResult = {
  cards: ListingCard[];
  requestsUsed: number;
  pagesOrScrollsUsed: number;
  actionsUsed: number;
  grew: boolean;                   // new stable identities appeared
  duplicateRate: number;           // 0..1 among this step
  blockedReason?: string;
  done: boolean;                   // adapter asserts directory exhausted
};

type DirectoryAdapter<TSession = unknown> = {
  readonly id: string;
  readonly version: string;
  acquire(input: {
    url: string;
    budget: CrawlBudget;
    signal?: AbortSignal;
  }): Promise<{
    mechanism: CrawlMechanism;
    requestedUrl: string;
    finalUrl: string;
    session: TSession;
  }>;
  /** One growth unit: next API page, one scroll batch, or one Next click. */
  grow(input: {
    session: TSession;
    budgetRemaining: CrawlBudget;
    seen: ReadonlySet<StableIdentity>;
    signal?: AbortSignal;
  }): Promise<GrowthStepResult>;
  release?(session: TSession): Promise<void>;
};

type DirectoryCrawlResult = {
  mechanism: CrawlMechanism;
  requestedUrl: string;
  finalUrl: string;
  cards: ListingCard[];
  inventory: SourceInventoryMetrics;
  stopReason: CrawlStopReason;
  sourceState: "healthy_complete" | "healthy_bounded" | "usable_partial" | "degraded" | "acquisition_failed" | "blocked_human_verification" | "blocked_authentication";
  pagesOrScrolls: number;
  actions: number;
  listingDurationMs: number;
  kernelVersion: string;
  adapterId: string;
  adapterVersion: string;
};

type DirectoryCrawlKernel = {
  crawl<TSession>(input: {
    adapter: DirectoryAdapter<TSession>;
    url: string;
    budget: CrawlBudget;
    signal?: AbortSignal;
    onProgress?: (event: CompactCrawlProgressEvent) => void;
    /** Caller-owned: grant one extension using cheap signals outside the kernel. */
    shouldExtend?: (snapshot: {
      uniqueGrowth: number;
      duplicateRate: number;
      noGrowth: boolean;
      remainingBudget: CrawlBudget;
    }) => boolean;
  }): Promise<DirectoryCrawlResult>;
};

  type CompactCrawlProgressEvent = {
    type: "acquired" | "grew" | "stopped";
    unique: number;
    pagesOrScrolls: number;
    stopReason?: CrawlStopReason;
  };
  ```

  **Forbidden in kernel:** `if (host.includes("devpost"))`, scoring, Supabase, detail page fetches, theme matching, location constraints.

  ---

  ## 3. Enrichment architecture (pipeline, not kernel)

  ```text
  directory acquisition
  → growth and listing collection          (kernel + adapter)
  → listing normalization → RawLead        (adapter mapper, thin)
  → cheap candidate triage                 (pipeline)
  → authoritative detail enrichment        (pipeline / source enrichers)
  → evidence reconciliation                (pipeline)
  → final hard query constraints           (pipeline)
  → classification / scoring / verification(pipeline)
  → batch persistence                      (pipeline)
  ```

  ### Listing-time required fields

  Must exist after listing normalization (else drop or mark unusable at triage):

  - stable identity (URL or composite title+date+source)
  - title
  - source attribution
  - listing URL or official URL candidate

  Nice-to-have at listing (do not block collect):

  - displayed date range / start / end
  - location text / mode hint
  - apply URL if present on card

  ### Detail enrichment triggers

  Enrich **only** when cheap triage says the card is potentially query-relevant **and** any of:

  - event start/end missing or ambiguous
  - application vs submission deadline needed for scoring and absent
  - eligibility unclear and query has eligibility constraint
  - location/remote mode unclear and query constrains location/remote
  - official URL missing but detail page likely exists (Devpost challenge subdomain, Luma event page)

  Never enrich the full raw inventory. Cap by independent `detailBudget`.

  ### Independent budgets

  | Budget | Controls | Must not steal from |
  |---|---|---|
  | `listingBudget` | API pages / scrolls / Next actions / listing wall-clock | detail |
  | `detailBudget` | official dates/overview pages, max detail opens | listing |
  | `totalSourceDeadline` | hard cancel | — |

  Rule: **listing completes (or hits listing stop) before detail starts**, except optional overlapping only when listing stop is already `exhausted` and CPU/network headroom remains.

  ### Evidence reconciliation

  Authority order (high → low), aligned with existing Devpost dates work:

  1. Official detail page labelled fields (e.g. Devpost `/details/dates`)
  2. Structured API fields from the source
  3. Listing card visible text
  4. Cross-source / web search snippets

  Field rules:

  - **Event dates:** official/API override listing display ranges; keep `displayedDateRange` separately.
  - **Application vs submission deadlines:** never collapse; missing application deadline alone does not force NEEDS_REVIEW when event dates verified (Phase 6.1 rule retained).
  - **Eligibility / location / remote:** prefer official; if conflict, mark needs_review reason rather than inventing.
  - **Weaker evidence** updates only nulls; never overwrite stronger non-null unless fingerprint proves same record and new evidence is higher authority.

  ---

  ## 4. Comparison to previous attempts (concrete)

  | Prior work | What it proved | Why production still hurt | This plan |
  |---|---|---|---|
  | Phase 3–4 persistence | Batch plan + owner/sheet protection works | V1 path still coexists; dual strategies | C1: batch-only after soak; delete V1 |
  | Phase 5 generic extractor | DOM units + growth actions can recover directories | Lived under `experiments/`; dual runtime | B1 extract thin lifecycle only |
  | Crawlee evaluation | Custom Playwright path was enough | Second framework cost never paid off | B4 delete Crawlee from production |
  | Adaptive orchestrator (5.3) | Profiles/checkpoints interesting in benches | Did not raise production Terminal recall; added complexity | **No global adaptive scheduler**; deterministic min + one extension |
  | AI page decision (5.4) | One bounded group pick recovers hackathons.space | Required LLM; probe forgot env; V1 fallback | Keep as **adapter/custom helper**, not kernel core; fail closed with clear state |
  | Vision paths (5.5) | Mostly stubs / not productionized | Dead weight | B4 delete |
  | Phase 5.6 Devpost API + dates | API pagination works; ~163 open/upcoming exhaust; dates pages work | Confused with HTML 40-page UI; detail steals listing time | A0/A1 inventory semantics + listing/detail split |
  | Phase 5.6 Luma budgets | Deep budgets > light | Sequential feeds + early filter + timeout → low usable | A2 collect-first + feed fairness |
  | Phase 6 / 6.1 V2 routing | off/shadow/live; space restored with LLM | Permanent V1/V2 split | B2 one kernel path; temporary shadow then B4 remove split |

  **Abandoned approaches removed (not re-lit):** Crawlee production path, vision-assisted crawl, recursive adaptive source scheduler, hostname-specific extractors inside a “generic” core, phase-numbered test directories as CI surface.

  **Reused proven components:** `collectUntilStable` ([`src/lib/browser/collectUntilStable.ts`](../../src/lib/browser/collectUntilStable.ts)), Devpost API pagination, Devpost dates enrichment (pipeline/enricher), Luma feed URL builders, bounded AI group selection (custom adapter only), batch persistence planner, Phase 6.1 result-count / deadline-review semantics.

  ---

  ## 5. Deterministic budget policy (no adaptive orchestrator)

Replace Phase 5.3-style global yield planning with:

```text
for each primary source/feed:
  reserved = minBudget(profile, feed)
  run until reserved exhausted OR no_growth OR blocked OR cancelled
  # Kernel-local extension signals only (no query relevance):
  if uniqueGrowth > 0 AND duplicateRate < D AND not no_growth AND remainingBudget:
    kernel may apply at most one structural extension
  # Optional caller outside kernel:
  if shouldExtend({ uniqueGrowth, duplicateRate, noGrowth, remainingBudget }):
    grant exactly one additional extension (caller may use cheap relevance)
  stop with explicit stopReason
```

**Kernel must not depend on query relevance.** Relevance-aware extension is a caller policy (`shouldExtend`), not kernel logic.

**Why simpler than Phase 5 adaptive orchestrator:**

- no cross-source recursive reallocation loop
- no checkpoint/resume orchestrator in v1 kernel
- no historical yield model required to crawl
- one boolean extension, not a planner
- stop reasons are local and testable

Luma example: each of city / AI / hackathon gets a reserved minimum; Tech only as fallback; one extension only when unique growth continues (caller may further gate on cheap relevance).

  ---

  ## 6. Learned crawl-plan invalidation

  ```ts
  type CrawlPlanV1 = {
    schemaVersion: 1;
    mechanism: CrawlMechanism;
    allowedOrigins: string[];
    route: string;                    // listing path pattern
    structuralSignature: string;      // hash of selected unit-set shape / API keys present
    pageFingerprint?: string;         // cheap, not full DOM
    lastSuccessAt: string;
    observedInventory?: number;
    lastQuality: DirectoryCrawlResult["sourceState"];
    consecutiveFailures: number;
  };
  ```

  **Validate cheaply before use:** origin/final URL allowlist, mechanism probe (API 200 with expected shape **or** listing container present), schemaVersion match.

  **Invalidate when:** redirect/origin change; missing expected structure; repeated no_growth with prior healthy inventory; quality collapse (`acquisition_failed` / blocked); auth/block; API failure; stale schemaVersion; `consecutiveFailures >= 3`.

  **Flow:** cached plan → validate → use if valid → on drift invalidate → bounded fresh discovery (no selectors treated as permanent truth) → save replacement **only after success**.

  Storage: prefer existing custom-source row metadata / JSON column if present; **no new migration in A–B** unless a column is already available. **File-backed crawl-plan storage under `.data/` is optional and non-authoritative** — cache loss or missing file must only trigger fresh bounded discovery, never a hard failure. Selectors are never permanent truth without validation.

  ---

  ## 7. Existing-code migration table

  | Current module | Responsibility | Destination | Action | Parity test | Deletion gate |
  |---|---|---|---|---|---|
  | [`src/lib/browser/collectUntilStable.ts`](../../src/lib/browser/collectUntilStable.ts) | Scroll/grow until stable | `src/crawl/growth/collectUntilStable.ts` or wrap in place | **move or wrap** | existing unit tests | none (keep) |
  | [`src/collectors/devpost.ts`](../../src/collectors/devpost.ts) API pages | API pagination | adapter `grow` + keep parse in adapter | **wrap** then share grow loop in B3 | API page contract tests + live inventory | do not delete adapter |
  | Devpost Playwright scroll listing | HTML scroll fallback | adapter alternate mechanism | **retain** behind under-extract gate | live under-extract case | keep until API proven sufficient |
  | Devpost dates enrichment | detail semantics | pipeline enricher (already mostly here) | **retain** outside kernel | dates mapping tests | n/a |
  | [`src/collectors/luma.ts`](../../src/collectors/luma.ts) scroll | feed scroll | adapter + shared growth | **wrap** in B3 | feed scroll unit + live deep | n/a |
  | Luma feed builders / filters | discovery coverage | adapter + pipeline relevance | **retain** split: feeds in adapter, relevance in pipeline | A2 live matrix | n/a |
  | [`src/experiments/scraper-v2/generic/acquisition.ts`](../../src/experiments/scraper-v2/generic/acquisition.ts) | browser/static acquire | `src/crawl/acquire.ts` | **move** selected APIs in B1 | B1 parity harness | delete experiment import B4 |
  | `browserActions.ts` / Next actions | Next-button growth | `src/crawl/growth/nextAction.ts` | **move** minimal | hackathons.space Next ≥2 | B4 |
  | `domRepeatedUnits.ts` / `domExtraction.ts` | card inference | **custom adapter** (not kernel) | **move** to `src/crawl/adapters/genericDom` | space/Eventornado | B4 experiments |
  | `aiPageDecision.ts` | AI group pick | custom adapter helper | **retain** bounded | space with/without LLM | not in kernel |
  | `visionPageDecision.ts` / visualGrouping | vision | — | **archive/delete** B4 | ensure unused | B4 |
  | `crawlRuntime.ts` Crawlee | second runtime | — | **delete** B4 | no production import | B4 |
  | `adaptiveCrawler.ts` / checkpoints / adaptiveProfiles | orchestrator | — | **archive** B4 | not required for A–B3 | B4 |
  | `quality.ts` source-state | classification | `src/crawl/sourceState.ts` | **move** slim enum | unit mapping | single model only |
  | `budget.ts` / collector profile budgets | profiles | one `src/crawl/budget.ts` + collector profile maps | **consolidate** | profile floor tests | no duplicate defs |
  | audit/experiment scripts | probes | `scripts/crawl/` | **retain** trimmed | manual | not in CI default |
  | [`genericScraperV2Mode.ts`](../../src/discovery/genericScraperV2Mode.ts) | off/shadow/live | thin router → kernel | **wrap** B2; simplify B4 | mode matrix | remove shadow after soak |
  | [`customSource.ts`](../../src/collectors/customSource.ts) V1 | Cheerio/PW custom | unreachable after B2 default | **retain unreachable** → **delete** | soak gate | max 14 days after B2 default |
  | V1 persistence strategy | per-row upsert | unreachable after C1 | **retain unreachable** → **delete** | soak gate | max 14 days after C1 |
  | batch persistence | plan writer | sole path | **retain** | idempotency tests | n/a |
  | `phase5*.test.ts` / phase snapshot suites | historical | `archive/` or delete | **archive/delete** C3 | not in default CI | C3 |
  | dual `sourceState` / profile defs | duplication | single modules | **consolidate** B1–C3 | compile + unit | C4 |

  **Anti–V3 rule:** B1 may only **move/wrap**; creating `src/crawl` while still calling experiments from production is a gate failure for B2 completion.

  ---

  ## 8. Benchmark matrix (generic + native growth)

  | Target | Mechanism | Expected state | Recall evidence | Precision sample | Stop reason |
  |---|---|---|---|---|---|
  | hackathons.space | Next | `healthy_complete` or `healthy_bounded` | ≥90% of observed inventory (~30+) | ≥90% of 10 titles | no_growth / exhausted |
  | Eventornado | scroll | `usable_partial` or better (honest) | report inventory vs collected | ≥80% of 10 | no_growth / max_budget |
  | Devpost | API | `healthy_complete` vs open+upcoming inventory | ≥95% of **API open+upcoming** inventory | listing titles sane | exhausted / no_next |
  | One static directory (e.g. hacklist or equivalent) | static | healthy/usable | cards ≥ prior V1 | ≥90% | exhausted |
| Previously unseen: **https://taikai.network/hackathons** (chosen for B2; not a native collector) | scroll or Next | usable_partial+ | collected > 0 with inventory estimate | ≥80% of 5 | no_growth / bounded |
| DoraHacks | blocked | `blocked_human_verification` | 0 leads, no retry loop | n/a | blocked |

“One random site works” alone is **not** a pass. The Taikai URL is locked before B2 begins; do not swap mid-migration without updating this matrix.

  ---

  ## 9. Devpost inventory semantics

  Measure and report separately (A0, then Terminal/telemetry):

  1. **current open/upcoming API inventory** (authoritative for default product)
  2. **rendered `/hackathons` scroll inventory** + which statuses appear
  3. **overlap** between (1) and (2)
  4. **closed/historical** estimate (explicitly non-default)
  5. **query-relevant** count after pipeline constraints

  Default production remains open+upcoming API. Additional statuses only if explicitly requested or A0 proves a clear product gap — never silent broaden-to-closed for volume.

  HTML `?page=` is documented unsupported; scroll or API only.

  ---

  ## 10. Luma discovery coverage

  **Feed order by query type:**

  | Query shape | Order |
  |---|---|
  | City / Toronto-like | location feed → AI → hackathon search → Tech fallback |
  | Theme AI without city | AI → hackathon search → Tech fallback |
  | Remote / broad hackathon | hackathon search → AI → Tech fallback |
  | Explicit tech social | Tech allowed earlier (rare) |

  **Policy:**

  - reserved minimum scrolls/events per primary feed
  - one extension if yield positive (deterministic policy §5)
  - merge/dedupe by normalized event URL across feeds
  - **collect-first:** do not drop cards inside grow for theme/hackathon; tag hints only
  - **relevance after collection** in pipeline triage
  - Tech is fallback when primary feeds under-deliver inventory
  - **detail enrichment deferred** until feed acquisition finishes (listing budget done)

  **Proof of improvement (not raw-only):**

  - raw unique inventory ↑ vs Phase 6 baseline on same profile
  - query-relevant ↑ on fixed query fixtures (remote AI 6mo; Toronto AI)
  - primary feeds not starved (each primary feed either exhausted or hit reserved min)
  - detail opens ≤ detailBudget and start after listing stop

  ---

  ## 11. Telemetry model (beyond Terminal)

  Compact run-level record (one object per source per job):

```ts
type SourceRunTelemetry = {
  source: string;
  adapterId: string;
  adapterVersion: string;
  kernelVersion: string;
  mechanism: CrawlMechanism;
  requestedUrl: string;
  finalUrl: string;
  observedInventory?: InventoryEstimate; // value+method+confidence only
  collectedRaw: number;
  collectedUnique: number;
  queryRelevant: number;
  enriched: number;
  queueReady: number;
  needsReview: number;
  rejected: number;
  pagesOrScrolls: number;
  actions: number;
  stopReason: CrawlStopReason | string;
  sourceState: string;
  listingDurationMs: number;
  detailDurationMs: number;
  totalDurationMs: number;
  failureClassification?: string;
};
```

**Where:** attach to existing discovery job `summary` / metrics JSON (already persisted for jobs) — **no new migration** for A0–C2. Optional rollup log line for local audits.

**Strict limits:** each source telemetry object ≤ **2KB** JSON; entire `summary.sourceTelemetry` array ≤ **16KB**; string fields truncated (URLs ≤ 512 chars, stopReason/failureClassification ≤ 120 chars). No DOM snapshots, HTML, or full page fingerprints in production telemetry.

**Retention:** same as discovery job rows.

  ---

  ## 12. Operational crawling constraints

  | Constraint | Policy |
  |---|---|
  | Per-host concurrency | ≤ 2 browser pages; ≤ 4 concurrent API GETs (Devpost batch already ~3) |
  | Delay/backoff | exponential on 429/5xx; jitter; respect Retry-After |
  | Browser-page concurrency | global cap (existing public source lock) |
  | Retries | ≤ 2 safe GETs; no retry loops on block/auth |
  | Caching | ETag/short TTL for API listing pages within a run only |
  | User agent | single identifiable UA string; no spoof arms race |
  | Cancellation | AbortSignal through kernel grow loop |
  | Max response size | align 5MB payload cap |
  | Auth/session | Hakku/Luma connected stay outside kernel; no credential in plans |
  | Blocked sources | hard stop classify; no bypass (DoraHacks) |
  | robots/terms | document review checklist before adding aggressive mechanisms; prefer official APIs |

  Optimize for **stable recall**, not maximum aggressive volume.

  ---

  ## 13. Anti-bloat constraints (hard)

  - only one production growth loop
  - only one batch persistence path (after C1; batch is production-only)
  - progressive job events coalesced (C2); cursor polling for Terminal
  - no production imports from `src/experiments/**` after B4
  - no new `phase-N` runtime directories
  - no second crawler framework
  - no duplicate source-state models
  - no duplicate crawl profile definitions
  - no source-specific logic in the generic kernel
  - no new test suite that snapshots an entire phase

  **Measurable outcomes at C4:**

  - production import graph to `experiments/scraper-v2` = 0
  - Crawlee not in production server graph
  - V1 persistence strategy file removed or `never imported`
  - custom V1 collector unreachable/removed
  - default `test:deterministic` file count and runtime reduced (target ≥25% fewer scraper phase tests)
  - Devpost per-page fingerprint warnings removed from default job events

  ---

  ## 14. Deletion / rollback plan

| Path | Activate | Soak / gate (risk-tiered) | Delete |
|---|---|---|---|
| Crawlee / vision | unused | **Low risk:** import graph = 0 and no production reference | B4 same window once unused |
| experiments imports | B1 wrap → B2 kernel | **Low–medium:** grep gate + custom parity | B4 |
| off/shadow/live flags | B2 keep shadow briefly | shadow optional ≤ 14 days | B4 remove; single path |
| Custom V1 collector | B2 kernel default | **Medium:** ≤ 14 days **and** controlled live parity (space, Eventornado, blocked, Taikai) | B4 after live parity |
| V1 persistence | C1 batch default | **Highest:** ≤ 14 days + idempotency + owner/sheet state-protection soak + delta create proof | C4 only |

**Shared deletion gate pieces:**

1. deterministic suites green
2. relevant benchmark / parity rows green
3. no production code path references old module (grep gate)
4. risk-tier soak above elapsed with no severity-1 regression
5. rollback flag removed in the **following** commit (not same commit as first activate)

  ---

  ## 15. Revised phase breakdown (smallest risk first)

### A0 — Inventory and telemetry truth
- **Entry:** plan approved
- **Hard constraint:** **do not create `src/crawl` during A0**; no kernel implementation; no production routing/persistence/experiment deletion; no scraper behavior rewrite
- **Work:** measure Devpost API vs scroll inventories; Luma per-feed yields before relevance; compact source telemetry in existing job summary; Terminal labels for inventory/raw/unique/query-relevant/queue-ready/needs-review/rejected/stop; before/after event-payload sizes
- **Exit:** documented numbers + telemetry evidence sufficient to decide A1/A2

### A1 — Devpost full-directory acquisition + listing/detail separation
- **Entry:** A0 numbers exist *(and corrected: 166 is open_upcoming_api_subset only)*
- **Work:** discover browser growth (`GET /api/hackathons?page=N` unfiltered); collect full directory before query filters; listing before detail; scoped telemetry
- **Exit:** deep ≥300 unique **or** proven directory exhaustion with network evidence; never treat 166 as full inventory — **met (500 unique, inventory 13601)**

### A2 — Luma collect-first and feed fairness
- **Entry:** A1 done or parallel if staffing allows (no shared file conflict)
- **Work:** multi-search/feed routes; reserved per-route budgets; collect events before classification; defer detail
- **Exit:** deep ≥200 unique events **or** per-route genuine no-growth below 200 — **met via no-growth proof at 144 unique**

### B1 — Kernel extraction, no behavior change
- **Entry:** A0 done (telemetry available for parity); first creation of `src/crawl` allowed here
- **Work:** create `src/crawl` with acquire/grow/budget/identity/stop/progress; **existing collectors still entry points**; internals call shared helpers
- **Exit / parity dimensions (all required):**
  - normalized identities match within tolerance
  - stop reason match (or equivalent class)
  - source state match
  - actions/pages within agreed numeric tolerance
  - cancellation behavior unchanged
  - latency non-regression (no material p50/p95 regression on focused fixtures)
- **Zero** intentional production behavior change

### B2 — Custom sources → kernel
- **Entry:** B1 exit; Taikai unseen benchmark recorded (§8)
- **Work:** custom adapter (DOM + optional AI pick); keep shadow comparison temporarily; natives untouched
- **Exit:** benchmark rows for space, Eventornado, DoraHacks, Taikai; shadow writes = 0

  ### B3 — Native growth → shared primitives
  - **Entry:** B2 exit
  - **Work:** Devpost API grow via kernel loop; Luma scroll via kernel loop; parsers stay in adapters
  - **Exit:** A1/A2 metrics hold; no new source-specific branches in kernel

  ### B4 — Remove obsolete paths
  - **Entry:** B3 exit + custom V1 soak gate
  - **Work:** drop experiments production imports; delete Crawlee/vision/unused adaptive; remove duplicate custom V1 routing; consolidate helpers
  - **Exit:** anti-bloat grep gates green

  ### C1 — Batch-only persistence
  - **Entry:** B3 at least (preferably B4)
  - **Work:** batch default; V1 unreachable
  - **Exit:** idempotency + delta tests; soak ≤14 days then C4 delete

  ### C2 — Pipeline / event payload optimization
  - **Entry:** C1 default on
  - **Work:** stage budgets; compact job events; Terminal refresh cost down
  - **Exit:** event payload size ↓; progressive streaming preserved

  ### C3 — Test/archive cleanup
  - **Entry:** B4
  - **Work:** archive phase snapshot tests; keep contract tests only
  - **Exit:** suite runtime/file count targets met

  ### C4 — Final soak and rollback removal
  - **Entry:** C1–C3 gates
  - **Work:** remove unreachable V1 shims; freeze constraints in AGENTS/docs
  - **Exit:** single growth loop + batch persist + no experiments imports

  ---

  ## 16. Risk register

  | Risk | Mitigation |
  |---|---|
  | Becomes V3 alongside V1/V2 | Hard anti-bloat + B1 “no behavior change” + grep deletion gates |
  | Kernel absorbs Devpost/Luma conditionals | Interface review; adapters-only parsing |
  | Enrichment starves listing again | Independent budgets; listing-first rule |
  | Crawl plans go stale | Versioned plan + invalidation §6 |
  | Adaptive complexity returns | Deterministic min + one extension only |
  | Luma “more raw” without relevance | Dual metrics gate |
  | Devpost closed-event pollution | Inventory semantics; no silent status broaden |
  | Deletion too fast | 14-day soak max; delete in later commit |
  | Telemetry needs migration | Prefer job summary JSON; no migration in A–C2 |
  | AI required for custom DOM | Explicit LLM warning; quality state; no silent V1 junk without metrics |

  ---

  ## 17. Deferred work (explicitly out of scope)

  - Exact-title web enrichment
  - DoraHacks bypass
  - X source
  - Global multi-source adaptive scheduler / checkpoint mesh
  - Vision-based scraping
  - New Supabase migrations (unless crawl-plan column later approved)
  - Broad NEEDS_REVIEW relaxation beyond Phase 6.1 deadline rule
  - Rewriting agent planner / Ask / UI chrome
  - Deploy

  ---

  ## 18. Artifacts checklist (this document)

  1. Revised architecture diagram — §1  
  2. Kernel/adapter interfaces — §2  
  3. Listing/enrichment/pipeline boundaries — §3  
  4. Migration table — §7  
  5. Phase breakdown with gates — §15  
  6. Benchmark matrix — §8  
  7. Crawl-plan invalidation — §6  
  8. Telemetry model — §11  
  9. Deletion/rollback — §14  
  10. Risk register — §16  
  11. Deferred work — §17  
  12. Recommendation — **Proceed** (staged), top of doc  

  ---

  ## 19. Approval ask

  Approve this revised plan for execution **starting at A0 only**, with re-approval required before B2 (first behavior change for custom sources) and before B4/C4 deletions.
