# Secret audit notes (packaging phase)

This file records the packaging-time secret audit. It does **not** contain secret
values.

## Scanner

```bash
npm run secrets:scan
```

## Working tree

| path | type | tracked | history | remediation |
| --- | --- | --- | --- | --- |
| `.env.local` | local env file | no (gitignored) | n/a | keep local; never commit |
| `.data/` | browser profiles / settings | no (gitignored) | n/a | keep local |
| `.local-audits/` | probe traces | no (gitignored) | n/a | keep local |
| `.env.example` | placeholders | yes | yes | placeholders only |

## Git history

- `.env.example` was added in history as a template (placeholders).
- No committed `.env` / `.env.local` files found via `git ls-files`.
- `git log -S` for common key prefixes did not surface an obvious committed live
  OpenAI/`sk-` production secret in tracked source docs during packaging scan.
- If a real credential is ever found in history: rotate it immediately; deleting
  the current file does **not** make history safe. History rewrite requires
  explicit approval.

## Client/server boundary

Server-only names include service-role key, `APP_PASSWORD`, session secret,
LLM/search keys, Google service-account JSON, X bearer, worker shared secret.
Only `NEXT_PUBLIC_*` values are browser-safe.
