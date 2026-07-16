# C3 — Test cleanup (scraper overhaul)

C3 is a **test-architecture** phase. It does not change crawl targets, routing,
query semantics, scoring, enrichment, persistence ownership, Queue behavior,
Terminal behavior, or crawl budgets.

## Goal

Reduce historical test/fixture bloat from Phases 3–6 while keeping a durable
contract suite for the production architecture:

- one crawl kernel;
- native adapters;
- one custom adapter;
- batch-only normal persistence;
- compact progressive events;
- cursor-based Terminal polling.

## Production contract map

| Area | Primary tests |
|---|---|
| Crawl kernel | `src/crawl/kernel.test.ts` |
| Native adapters | `src/crawl/adapters/nativeAdapters.contracts.test.ts`, collector unit tests |
| Custom directory | `src/crawl/adapters/custom/customAdapter.test.ts`, `kernelGrowth.test.ts`, `customRouting.contracts.test.ts` |
| Custom routing | `src/discovery/customSourceRouting.test.ts` |
| Batch persistence | `src/discovery/persistence/batchPersistence.contracts.test.ts`, plan/repo/strategy tests |
| Terminal / polling | `src/lib/terminal/terminalContracts.test.ts`, `formatEvent.test.ts`, jobs/events route tests |
| Pipeline performance | `src/discovery/c2Performance.contracts.test.ts`, `performance.test.ts` |

## Suite commands

See [`TEST_CONTRACTS.md`](./TEST_CONTRACTS.md).

## Fixture policy

- Keep minimal deterministic samples under `src/collectors/__fixtures__/`.
- Do not commit `.local-audits/` (gitignored).
- Do not add phase-snapshot suites or re-import archived experiment runtimes.

## Rule

Tests protect current production contracts, not historical implementation phases.
