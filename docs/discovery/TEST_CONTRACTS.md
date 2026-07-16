# Discovery / scraper test contracts

Tests protect **current production contracts**, not historical implementation phases.

## Suite responsibilities

| Command | Scope |
|---|---|
| `npm test` / `npm run test:fast` | Fast deterministic unit suite (agent, core, crawl, collectors, lib, components, hooks) |
| `npm run test:scraper` | Kernel + adapter + collector contracts |
| `npm run test:integration` | Discovery, jobs, server, API boundaries |
| `npm run test:deterministic` | All `src/**/*.test.ts(x)` — no live network required |
| `npm run test:persistence-benchmark-guards` | Audit-tool guards for `scripts/persistence/` (not default CI) |
| `npm run test:live:sources` | Prints live probe commands only |

Canonical architecture: [`FINAL_ARCHITECTURE.md`](./FINAL_ARCHITECTURE.md). Ops: [`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md).

## Deterministic policy

Default suites must not depend on:

- current network inventory;
- live Luma/Devpost totals;
- wall-clock calendar dates for relative parsing (use injected/fixed clocks);
- browser timing;
- owner credentials.

Relative-date collector tests must pass a fixture `now` (or equivalent) rather than `Date.now()`.

## Live / browser probes (non-default)

- `npx tsx scripts/b3-native-kernel-probe.ts`
- `npx tsx scripts/b2-custom-kernel-benchmark.ts`
- `npx tsx scripts/c2-pipeline-performance-probe.ts`
- dry-run `npm run agent -- "…" --dry-run`

Do not silently skip live failures inside deterministic CI.

## Fixture policy

Keep minimal HTML/API samples under `src/collectors/__fixtures__/`.

Do not commit:

- `.local-audits/` probe dumps;
- phase snapshot markdown;
- full live page dumps;
- browser traces with cookies.

## Adding a new source contract

1. Unit-test pure parsers/budgets with fixtures + fixed clocks.
2. Adapter/kernel contract for growth/stop reasons.
3. One integration boundary if routing/pipeline wiring changes.
4. Optional live probe script — never the default suite.

## Prohibitions

- No phase-snapshot suites (`phase5*.test.ts`, experiment audit mirrors).
- No imports of archived/removed experiment runtimes from production or tests.
- No duplicate five-way coverage of the same assertion without distinct bug value.
