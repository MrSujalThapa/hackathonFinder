# Privacy and data handling

Hackathon Finder is a **self-hosted, single-operator** application. It is not a
multi-tenant SaaS product. This statement describes intended behavior; it is
**not** a claim of GDPR/CCPA or other regulatory certification.

## What is stored

- Discovered **public** event metadata (title, dates, location, URLs, themes,
  scores, evidence snippets) when persistence is enabled
- Review actions (approve / reject / save / restore) and optional Ask answers
- Discovery job events for Terminal progress
- Optional Google Sheets rows when the operator explicitly syncs approvals

## Where data lives

- **Supabase** (full mode): candidates, evidence, actions, discovery jobs/events,
  terminal sessions (when configured)
- **Google Sheets** (optional): approved candidates only, via explicit sync
- **Local `.data/`** (gitignored): browser profiles, source settings, crawl-plan
  caches on the operator machine

## What is not claimed

- The app does not bypass CAPTCHAs, WAFs, or authenticated walls
- API keys and passwords remain server-side / local; they must not be committed
- Logs and issue reports should omit credentials and session cookies
- Dry-run discovery does not write candidates
- `DEMO_MODE=true` uses fixture Queue data and forces dry-run persistence

## Operator responsibilities

- Keep `.env.local` private
- Rotate credentials if exposed
- Do not point collectors at infrastructure you do not own for security testing
- Sanitize logs before sharing
