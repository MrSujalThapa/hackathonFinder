# Luma discovery modes

## Public mode (default)

Used for ordinary discovery. No login, no stored credentials.

Sources of leads:

1. **City hubs** (`https://luma.com/toronto`, `/waterloo`, …) — embed individual events in `__NEXT_DATA__`.
2. **Discover pages** (`/discover?q=hackathon`) — mostly place directories; the collector only keeps embedded `evt-*` objects that look like hackathons.
3. **Individual event pages** — `initialData.kind === "event"`; used for enrichment (organizer, registration).

Filters:

- Hackathon-like titles/descriptions only (meetups excluded).
- Upcoming / not clearly ended (`end_at` / `start_at`).
- Reject bare discover, calendar hubs, sign-in, and profile URLs as candidate events.

## Connected / authenticated mode (optional, stubbed)

Opt-in via `LUMA_MODE=authenticated` (or `connected`).

**Not required** for public discovery. When requested, the collector warns that connected mode is unavailable and continues in public mode.

If implemented later, it should reuse the same **persistent Playwright browser profile** architecture as Hakku (`BROWSER_PROFILE_ROOT`, connect/status/disconnect scripts) — never store Luma passwords in env/files, never automate credential entry.

## Does authentication materially help?

Based on public probes (2026-07):

| Capability | Public | Likely with auth |
|---|---|---|
| City hub event listings | Yes | Same |
| Individual public event pages | Yes | Same |
| Hackathon filtering | Yes (title/heuristics) | Same |
| Private / invite-only events | No | Possibly |
| Followed calendars / saved registrations | No | Yes |
| Broader personalized discovery | Limited | Possibly |

**Conclusion:** Auth is not needed for the default Hackathon Finder pipeline. It would mainly help for private events and followed calendars — out of scope for ordinary public discovery, and intentionally stubbed until a persistent-browser connector is warranted.
