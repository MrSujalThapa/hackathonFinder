# Hakku persistent browser profile

Hakku discovery uses a **Playwright persistent context** so the owner can log in once and reuse the session across collector runs.

## Commands

```bash
# Headed browser — log in manually, then close when connected
npm run source:connect -- hakku

# Lightweight auth probe (no full discovery)
npm run source:status -- hakku

# Remove only the Hakku profile (requires confirmation)
npm run source:disconnect -- hakku --confirm
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `BROWSER_PROFILE_ROOT` | `.data/browser-profiles` | Root directory for source profiles (relative to cwd, or absolute for workers) |
| `HAKKU_PROFILE_NAME` | `hakku` | Subfolder under the root |
| `HAKKU_BROWSER_HEADLESS` | `true` | Collector/status headless mode (`source:connect` always headed) |

Resolved profile path:

```text
path.resolve(cwd, BROWSER_PROFILE_ROOT, HAKKU_PROFILE_NAME)
```

Examples:

- Local: `.data/browser-profiles/hakku/`
- Worker volume: `/data/browser-profiles/hakku`

## Security notes

- **Manual login only** — no username/password automation.
- Never commit `.data/browser-profiles/` (gitignored).
- Do not log cookies, storage state, or profile paths to client APIs.
- Prefer a dedicated Hakku account when practical.
- Treat the profile directory like a password store; restrict filesystem permissions on shared hosts.
- `source:disconnect` removes/archives only the Hakku profile, not other sources.

## Collector behavior

- Health-checks auth before accepting leads.
- Login redirect → `auth_required` error (not a fake zero-lead success).
- Bounded navigation/scroll; upcoming filtering; failure screenshots only under the OS temp debug dir.
- Metrics include mode, pages inspected, raw/accepted leads, auth status, and stop reason.
- **Profile lock:** discovery serializes Hakku to one Chromium persistent context at a time (see [CONCURRENCY.md](./CONCURRENCY.md)). A lock wait timeout degrades Hakku only — other sources continue.

## Manual acceptance (next phase)

Live connect against a real Hakku account is intentional owner work after this phase. Automated tests use fixtures/mocks only.
