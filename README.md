# HackFinder

An agentic opportunity discovery + application system: it finds hackathons and events from a natural-language query, then takes an application from discovery through a ready-to-submit real form — with you holding the final Submit button.

## What HackFinder does

Finding the opportunity is only half the work. HackFinder finds it *and* gets the application ready:

```
Natural-language search
  → live discovery
  → verification / ranking
  → Queue
  → Apply
  → inspect the real application
  → resolve answers (Profile / Question Bank / Asset Bank)
  → AI drafts unresolved text
  → Discord / in-app blockers when something is missing
  → resume
  → deterministic reconciliation against the real form
  → explicit, version-bound Submit-now authorization
```

This loop has been validated end-to-end against a real external hackathon application form — not just a fixture.

## Demo

A ~60-second walkthrough of the full loop — natural-language search → Queue → application draft → Profile/Question Bank/Asset Bank/AI resolution → a Discord blocker → real-form reconciliation → the explicit Submit-now boundary — is generated locally with [`brag`](https://github.com/latent-spaces/brag) (a HyperFrames-based video workflow) rather than recorded against a live app with real data.

It renders to `brag-output/brag.mp4`, which is git-ignored (regenerable, not published to the repo). To regenerate it locally:

```bash
claude plugin marketplace add latent-spaces/brag
claude plugin install brag@brag
# then, from a Claude Code session in this repo:
/brag
```

## Core features

- Natural-language discovery via the Terminal, with `light` / `deep` profiles
- Native adapters for Devpost and Luma, plus HackList / MLH / Hakku / web search / custom directories
- Dynamic city / province / remote / date-window query parsing (application-deadline vs. event-date semantics)
- Queue for reviewing, saving, approving, and applying to candidates
- Application agent that inspects and fills real, multi-page application forms
- Profile, Question Bank, and Asset Bank resolve known answers and reusable files automatically
- AI drafts unresolved free-text answers when an LLM provider is configured
- Discord remote control — reuses the same HackFinder services as the web app, not a separate bot
- In-app notifications for blockers and status changes
- Explicit, version-bound "Submit now" authorization — nothing submits silently
- Local-first runtime (`npm run hackfinder`) with a scheduled discovery worker and application tracker
- Optional private phone access over Tailscale Serve
- Optional Google Sheets sync for approved candidates

## Architecture

```
Discord / Terminal / Scheduler
        │
        ▼
 Discovery pipeline
        │
        ▼
 normalize → verify → score → dedupe
        │
        ▼
       Queue
        │
        ▼
 Application engine
        │
        ▼
 Profile + Question Bank + Asset Bank + AI
        │
        ▼
 blockers / Discord
        │
        ▼
 deterministic form reconciliation
        │
        ▼
 explicit "Submit now"
```

## Quick start

```bash
git clone https://github.com/MrSujalThapa/hackathonFinder.git
cd hackathonFinder
npm ci
npx playwright install chromium
cp .env.example .env.local
```

Fill in the minimum configuration below, then apply the Supabase migrations in `supabase/migrations/` (numeric order, `001`…`014`) through the Supabase SQL editor or CLI.

Run the full local runtime:

```bash
npm run hackfinder
```

Open [http://localhost:3000](http://localhost:3000) and sign in with `APP_PASSWORD`.

`npm run dev` starts only the Next.js dev server. `npm run hackfinder` is the recommended full local runtime — it starts the web app (if not already running), the Discord gateway worker (once fully configured), a scheduled discovery pass, and an hourly application tracker, all supervised together. See [`LOCAL_RUN.md`](LOCAL_RUN.md) for details and `npm run hackfinder:status` to check configuration without printing secrets.

## Minimum configuration

```bash
# .env.local
APP_PASSWORD=change-me
APP_SESSION_SECRET=replace-with-32-plus-random-characters!!
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Supabase is required for Queue persistence, applications, Profile, Question Bank, and Asset Bank storage. Everything else — LLM, search provider, Discord, Google Sheets, Tailscale — is optional and additive. See `.env.example` for the full, grouped, commented variable list (required vs. optional).

## Discord remote control

Discord talks to the same application/discovery services the web app uses — there is no separate bot engine. Once `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`, and `DISCORD_USER_ID` are set, `npm run hackfinder` starts the gateway automatically (or run it alone with `npm run worker:discord`).

Example commands:

```
status
show drafts
show <draft> q&a
find hackathons in Toronto next month
```

Only the configured `DISCORD_USER_ID` can run owner commands (answering blockers, pausing/resuming a draft, Submit-now).

## Private phone access

HackFinder is local-first: your laptop runs it, and Tailscale Serve can expose it privately to your own devices.

```
local laptop  →  private tailnet  →  phone
```

- No Tailscale Funnel and no public hosting required
- The laptop must stay awake and keep the runtime running for phone access to work
- Set `APP_BASE_URL` to your private Tailscale Serve HTTPS URL — see [`LOCAL_RUN.md`](LOCAL_RUN.md)

## Application safety

- No silent submission — every submission requires an explicit, version-bound "Submit now" action from you
- The real external form is reconciled against the draft immediately before that action; a mismatch blocks submission
- CAPTCHA, MFA, and login walls pause the flow for you to complete manually — they are never bypassed

## Development / Testing

```bash
npm run lint
npm run typecheck
npm run build
npm run test:deterministic
```

`npm run check` runs lint + typecheck + build together. `npm run env:check` validates environment variable names/formats without contacting external services or printing secrets. Live source probes are intentionally manual (see `npm run test:live:sources`) and are not part of the default test suite.

## Tech stack

Next.js · React · TypeScript · Supabase (Postgres + Storage) · Playwright · Discord · a pluggable LLM/search provider abstraction (OpenAI-compatible / mock)

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and [`SECURITY.md`](SECURITY.md) for vulnerability reporting.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
