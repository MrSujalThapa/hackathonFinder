# Discovery source audit

**Branch:** `step-11-terminal-and-source-reliability`  
**Date:** 2026-07-12  
**Scope:** Read-only architecture + bounded live probes. No collector code changes.

Raw probe scripts: `docs/discovery/audit-notes/probe-endpoints.mjs`, `docs/discovery/audit-notes/probe-collectors.mjs`.

---

## Collector matrix

| Source | Registered | Default enabled | Transport | Auth | Live result | Failure mode | Deployment constraint |
|--------|------------|-----------------|-----------|------|-------------|--------------|------------------------|
| **mlh** | Yes | Yes (`REAL_DEFAULT_SOURCES`) | HTTPS HTML + Inertia JSON; Playwright fallback on empty/403/429 | None (public) | **Working** — probe: 8 leads / 2.9s; HTTP 200 with `upcomingEvents` Inertia payload | Soft warnings; empty leads if all listing URLs fail parse | Needs outbound HTTPS; Playwright browsers optional but used under bot blocks |
| **web** | Yes | Yes | Search API (`SEARCH_PROVIDER` / Tavily locally) | API key (`SEARCH_API_KEY`) | **Working** — probe: 8 leads / 12.4s (hit timeout budget); env: `SEARCH_PROVIDER=tavily` | Warning + skip if unconfigured; per-query warnings; early stop on timeout | Requires paid/configured search provider in deploy env; mock provider for tests only |
| **hacklist** | Yes | Yes | Static HTTPS HTML (`hacklist-omega.vercel.app`) + Cheerio | None (public) | **Working** — probe: 8 leads / 0.6s; HTTP 200 with `article[aria-label]` cards; recent agent_runs: 25 leads | Warning if HTML has no cards (SSR regression) | Public site availability; no Playwright today |
| **luma** | Yes | Yes (code default) | HTTPS discover URLs + Playwright fallback | None (public) | **Broken / empty** — probe: 0 leads; HTTP 200 Next.js shell (`__NEXT_DATA__`) without `event-card` selectors; cheerio/Playwright yield no hackathon cards | Warning: “no likely hackathon events…” | Client-rendered discover UI; default includes it but operators often omit via `--sources=` |
| **devpost** | Yes | **No** (opt-in) | HTTPS listing + Playwright fallback | None (public) | **Broken / empty** — HTTP 200 with many `devpost.com` hrefs, but collector probe: 0 leads (“no hackathon cards”); Playwright did not recover | Warning after static + Playwright; no hard error | Selector/HTML drift; Playwright browsers needed for JS-heavy listings |
| **hakku** (alias “haiku”) | Yes | **No** (opt-in) | Playwright-only swipe UI | **Login wall** when credentials prompt detected | **Broken / empty** — HTTP ~2KB SPA shell; collector: 0 leads (“no visible cards”); not login-required in this probe | Warning if login; warning if empty; error if Playwright missing | Requires Playwright in deploy/runtime; may need auth/session later |
| **x** | Yes | **No** | HTTP MCP (`X_MCP_URL`) + bearer token | `X_BEARER_TOKEN` | **Not executed in this audit** (policy: no `--sources=x`); env tokens present locally | Soft skip if unconfigured; quota/rate warnings stop remaining queries; auth errors stop run | Explicitly excluded from production recipes until credits funded (`docs/DEPLOYMENT.md`) |
| **mock** | Yes | **No** | In-process fixtures | None | Always returns fixture leads | Live DB writes refused unless `USE_MOCK_CANDIDATES` / `--allow-mock-writes` / `--dry-run` | Forbidden for production candidate pollution |

**Notes on columns**

- **Registered:** present in `src/collectors/registry.ts` `COLLECTORS` map.
- **Default enabled:** in `REAL_DEFAULT_SOURCES` (`hacklist`, `mlh`, `luma`, `web`) used by `parseCommand` / `getDefaultDiscoveryPreferences`. CLI `--sources=` and LLM planner may subset.
- **Live result:** evidence from 2026-07-12 HTTP probes + `runCollectors` dry-run smoke (maxResults=8, timeoutMs=12s) and/or recent `agent_runs` metadata — not inferred from class existence alone.

---

## Pipeline map

```text
CLI (src/cli/agent.ts)
  → parseAgentArgs (--sources, timeouts, --agent, --dry-run, …)
  → runAgent (src/agent/runAgent.ts)
       → parseCommand → DiscoveryPreferences (defaults = REAL_DEFAULT_SOURCES)
       → applyCliOptions (CLI sources/maxResults override)
       → [optional agent mode]
            parseIntent → planDiscoveryWithLlm | planDiscovery
            runLoop (tool registry; dryRun collectors in planner path; short runtime limits)
       → runDiscovery (src/agent/controller.ts)   ← real workhorse
            runCollectors(preferences.sources)     ← parallel per source
            enrichPromisingLeads
            extractHackathonEvents
            mergeCrossSourceEvents (dedupe / authority)
            classifyHackathonEvent
            verifyHackathonEvent
            scoreHackathonEvent
            upsertCandidateByFingerprint + addEvidence
            createAgentRun / completeAgentRun
       → printAgentSummary (stdout)
```

| Stage | Primary modules | Reusable? |
|-------|-----------------|-----------|
| CLI arg parse | `parseAgentArgs` | Yes (pure) |
| Command → prefs | `parseCommand`, `REAL_DEFAULT_SOURCES` | Yes |
| Planner | `planDiscovery`, `planDiscoveryWithLlm`, `planSearchQueries`, `planXQueries` | Yes (returns plans) |
| Agent runtime | `runLoop`, `executeTool`, `tools.ts` collector tools | Mostly reusable; used for inspectable plans more than production collection |
| Collect | `registry.runCollectors` + per-source collectors | Yes |
| Enrich / extract / merge | `enrichLead`, `extract`, `mergeEvents` | Yes |
| Classify / verify / score | `classifyEventPage`, `verify`, `score` | Yes |
| Persist | `repository.upsertCandidateByFingerprint`, `addEvidence`, `runs.ts` | Yes |
| Summary print | `printAgentSummary`, plan `console.log`s | **Stdout-coupled** |

### Reusable vs stdout-coupled

**Reusable (library-shaped):** collectors + registry, `parseCommand`, planners, `runDiscovery` (returns `AgentRunSummary`), enrichment/extract/verify/classify/score/dedupe, Supabase persistence.

**Stdout-coupled:** `runAgent` plan/trace printing, `controller` search/X plan dumps, `printAgentSummary`. A terminal/API surface can call `runDiscovery` without the CLI printer.

**Important runtime split:** Agent `runLoop` tool calls use short limits (`maxElapsedMs` 10s, `perToolTimeoutMs` 5s) and planner-path `dryRunCollectors: true`. Actual lead volume comes from `runDiscovery` → `runCollectors`, not from the agent tool loop.

---

## Source selection behavior

| Mechanism | Sources used |
|-----------|--------------|
| Code default | `REAL_DEFAULT_SOURCES = ["hacklist","mlh","luma","web"]` (`src/collectors/types.ts`) |
| Command text mention | `extractSources` can add `devpost`, `hakku`, `x`, `mock`, etc. |
| CLI `--sources=` | Hard override via `applyCliOptions` |
| LLM planner | May **subset** only within allowed `preferences.sources`; cannot add sources not already allowed |
| Deterministic `planDiscovery` | Plans tools for each preference source (skips `mock` collect tool) |

**Not default:** `devpost`, `hakku`, `x`, `mock`.

**Selectable aliases:** CLI `twitter` → `x`; command text `haiku` is **not** aliased (only `hakku`).

---

## Why recent runs look like “mainly MLH and web”

Evidence (not speculation):

1. **Operator recipes omit luma.** `docs/DEPLOYMENT.md` documents `--sources=hacklist,mlh,web`. Last 7 days of `agent_runs`: **4 runs** used exactly that set (avg 75 raw leads); only **2 runs** included full defaults with `luma`.
2. **Stored candidates skew web.** Live DB counts: `web` 40, `hacklist` 13, `mlh` 6, `mock` 3 — **zero** `luma` / `devpost` / `hakku` / `x`. Web wins on accepted unique fingerprints even when hacklist+mlh also collect.
3. **Recent completed runs with sourceStats** (e.g. `72209ad7-…`): hacklist 25 leads / 13 accepted, mlh 25 / 5, web 25 / 13 — all three fire; perception of “MLH + web” understates **hacklist**, which is healthy.
4. **Luma/devpost/hakku do not contribute.** Live collector probe (this audit): luma/devpost/hakku → **0 leads**. Even when luma is in the source list, it adds duration/warnings without candidates.
5. **X is intentionally off.** Deployment docs: do not run `--sources=x` until credits funded. One historical run listed `x` in sources but no `sourceStats` metadata to verify contribution.

---

## Per-source findings

### mlh

- Parses Inertia `upcomingEvents` first, then Cheerio card fallback; multi-URL season listing (`/events`, `/seasons/{year+1}/events`, …).
- Live: redirect to 2027 season schedule; Inertia JSON present; collector returns leads without Playwright.
- Unit tests: fixture + Inertia parse coverage (pass).

### web

- Depends on `createSearchProviderOptional`; local env has Tavily configured.
- Query planning via `planSearchQueries`; filters directories/articles via `classifyEventPage` + vocab.
- Soft-fail when `SEARCH_*` missing; live runs produce many accepted candidates (DB dominant source).
- Timeout budget shared across many queries → early-stop warnings under 12–15s caps.

### hacklist

- SSR HTML with `article[aria-label]` — static fetch is enough (no Playwright).
- Default + frequently selected; recent agent_runs show consistent 25 leads.
- Underrepresented in “MLH+web” narrative but **live and default**.

### luma

- Default-enabled in code, but discover pages are Next.js client shells; selectors (`article.event-card`, etc.) do not match static HTML.
- Probe warning only; no leads. Highest priority default-source reliability gap.

### devpost

- Registered and tool-wired (`collect_devpost`) but **not** in `REAL_DEFAULT_SOURCES`.
- Listing HTML contains challenge links; Cheerio selectors still returned 0 in live probe → parser/DOM mismatch; Playwright fallback also empty under 12s.
- Unit tests pass on fixtures only.

### hakku

- Playwright-only against `/swipe`; detects login walls.
- Probe: SPA shell, no cards, no login detection this run → UI change or interaction-gated.
- Opt-in only; needs browser install in any headless deploy job.

### x

- MCP HTTP transport; read-only tool allowlist; rich metrics on collector result.
- Config present locally; excluded from defaults and prod recipes.
- This audit did not invoke X collectors (repo policy).

### mock

- In-memory fixtures for pipeline tests / local UI.
- Live upserts gated by `USE_MOCK_CANDIDATES` / `--allow-mock-writes`.

---

## Diagnostics / scripts relevant to sources

| Script | Role |
|--------|------|
| `npm run agent` | Full discovery CLI |
| `npm run candidates:audit-sources` | Read-only candidate `source` histogram |
| `npm run check:x` | X MCP connectivity (do not treat as default discovery) |
| `npm run check:llm` / `check:supabase` / `check:prod` | Adjacent env gates |
| Unit tests `src/collectors/*.test.ts` | Fixture/parser coverage (44/44 pass in filtered run) |

---

## Live check summary (2026-07-12)

### HTTP listing sniff (`probe-endpoints.mjs`)

| Source | Status | Notable |
|--------|--------|---------|
| mlh | 200 (~1.1s) | Inertia `upcomingEvents` present |
| hacklist | 200 (~74ms) | `article[aria-label]` present (~33 articles) |
| devpost | 200 (~158ms) | Many `devpost.com` hrefs |
| luma | 200 (~410ms) | `__NEXT_DATA__`; no event-card markup |
| hakku | 200 (~82ms) | Tiny SPA HTML (~2.3KB) |

### Collector dry-run (`probe-collectors.mjs`, maxResults=8, 12s timeout)

| Source | Leads | Duration | Outcome |
|--------|------:|---------:|---------|
| hacklist | 8 | 597ms | OK |
| mlh | 8 | 2925ms | OK |
| web | 8 | 12431ms | OK (timeout warning) |
| luma | 0 | 2776ms | Empty warning |
| devpost | 0 | 6539ms | Empty warning |
| hakku | 0 | 5180ms | Empty warning |

### Unit tests

Filtered collector/planner suite: **44 passed**, 0 failed.

---

## Blockers / reliability gaps

1. **luma default is a no-op** against current public discover HTML — either drop from defaults until fixed, or parse `__NEXT_DATA__` / harden Playwright waits.
2. **devpost live parse broken** despite reachable listing — selector refresh + Playwright validation needed before promoting to default.
3. **hakku live scrape empty** — UI/auth/interaction; Playwright install is a hard deploy dependency if enabled.
4. **web is env-gated** — without `SEARCH_PROVIDER`+`SEARCH_API_KEY`, default set silently loses breadth (warning only).
5. **Operational source lists diverge from code defaults** — deploy docs and recent runs use `hacklist,mlh,web`, so luma never gets exercised in the field.
6. **X** — configured locally but product policy keeps it off production discovery until quota/credits are intentional.

---

## Registry quick reference

| Source | In registry | In REAL_DEFAULT | Agent tool | Fallback path | Mock |
|--------|:-----------:|:---------------:|------------|---------------|:----:|
| mlh | ✓ | ✓ | `collect_mlh` | Playwright | |
| web | ✓ | ✓ | `collect_web` | skip if no search config | mock provider optional |
| hacklist | ✓ | ✓ | `collect_hacklist` | none | |
| luma | ✓ | ✓ | `collect_luma` | Playwright | |
| devpost | ✓ | | `collect_devpost` | Playwright | |
| hakku | ✓ | | `collect_hakku` | Playwright-only | |
| x | ✓ | | `collect_x` | soft skip / quota stop | |
| mock | ✓ | | finalize only | n/a | ✓ |
