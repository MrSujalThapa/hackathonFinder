# Contributing

Thanks for considering a contribution to Hackathon Finder.

This is a **self-hosted** hackathon discovery and review workspace. Preserve the
production discovery architecture unless a change explicitly requires otherwise.
Canonical reference: [`docs/discovery/FINAL_ARCHITECTURE.md`](docs/discovery/FINAL_ARCHITECTURE.md).

## Local setup

1. Node.js 20+ and npm 10+
2. `npm ci`
3. `cp .env.example .env.local` and configure values (see README)
4. `npm run env:check`
5. Apply Supabase migrations for full mode (see README)
6. `npx playwright install chromium` when browser collectors are needed
7. `npm run dev`

Minimum local / demo mode can run with fixture candidates (`DEMO_MODE=true` or
`USE_MOCK_CANDIDATES=true`) without live Sheets writes. Full discovery still
needs network access for public sources.

## Branch naming

- `feat/...` feature work
- `fix/...` bug fixes
- `docs/...` documentation
- `chore/...` tooling / packaging
- `release/...` release preparation

Do not push directly to `main`. Open a pull request.

## Testing expectations

- Prefer focused tests next to the code they protect
- Tests protect **current production contracts**, not historical phase snapshots
- Do not import archived/removed experiment runtimes
- Before requesting review, run at least:

```bash
npm run env:check
npm run typecheck
npm test
npm run build
```

When touching collectors or crawl code, also run:

```bash
npm run test:scraper
```

When touching jobs, Terminal, or API routes, also run:

```bash
npm run test:integration
```

## Formatting and linting

```bash
npm run lint
npm run typecheck
```

Match existing TypeScript style. Avoid unrelated refactors.

## Architecture boundaries

- Native adapters (Devpost, Luma, …) + generic custom directory adapter
- `DirectoryCrawlKernel` for directory growth
- Batch persistence is the sole normal writer
- Queue review UI and Google Sheets sync are separate boundaries
- Do **not** reintroduce selectable custom V1 or per-row persistence routes

## Source-adapter policy

- No hostname-specific custom scraper logic without maintainer approval
- No CAPTCHA / WAF bypass
- Blocked or authenticated pages must fail honestly
- Do not change source targets, query semantics, scoring, persistence, Queue
  logic, or crawl budgets unless the task explicitly requires it and tests cover
  the contract

## Secrets

- Never commit `.env`, `.env.local`, service-account JSON, cookies, or storage state
- Never put secrets in `NEXT_PUBLIC_*` variables
- Do not paste credentials into issues or PRs
- Run `npm run secrets:scan` when touching env/docs/fixtures

## Pull requests

- Keep PRs scoped and reviewable
- Describe behavior changes and test evidence
- Link related issues
- Do not include generated audit traces (`.local-audits/`), local `.data/`, or
  personal files

## Code of conduct

Participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
