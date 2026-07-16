# Demo script (3–5 minutes)

Goal: show natural-language discovery with strict filters, progressive Terminal
telemetry, custom-source crawling, and Queue review — without depending on
fragile live writes.

Prepare with [`docs/DEMO_CHECKLIST.md`](DEMO_CHECKLIST.md). Prefer
`--profile light --dry-run`. Keep `DEMO_MODE=true` as Queue fallback.

---

## 1. Problem (20s)

Finding relevant hackathons across Devpost, Luma, HackList, and random
directories is slow: tabs, inconsistent dates, and weak location/remote
semantics.

## 2. Product (20s)

Hackathon Finder: natural-language discovery, strict dates/location/remote
rules, evidence-backed candidates, Queue review, optional Sheets sync.

## 3. Terminal — primary demo (90–120s)

Run (Terminal UI or CLI):

```text
find upcoming AI hackathons in Toronto or remote in the next 6 months --profile light --dry-run
```

Call out:

- Parsed interpretation (theme, Toronto, **or remote**, date window)
- Progressive source inventory (Devpost / Luma / others)
- Event dates vs application/submission deadlines
- Queue-ready vs Needs Review framing (dry-run: would-write counts)

Fallback if Luma is slow: continue with Devpost progress; say “Luma degraded,
others continue.”

Fallback if OpenAI unavailable: “Deterministic planner still runs; LLM
enrichment is optional.”

Fallback if a source is blocked: point at honest stop reason / blocked policy
(no CAPTCHA bypass).

Fallback if network fails: switch to Queue fixture demo (`DEMO_MODE`).

## 4. Custom source (45–60s)

```text
find upcoming hackathons from Reskilll in the next 12 months --profile deep --dry-run
```

Explain: generic **CustomDirectoryAdapter** + **DirectoryCrawlKernel**, not a
hostname-specific scraper. Deep may take tens of seconds — say so.

If Reskilll is down: show Settings custom-source entry + architecture slide /
`FINAL_ARCHITECTURE.md` diagram verbally.

## 5. Queue (45s)

With `DEMO_MODE=true` (or a safe local Queue):

- Swipe/approve/reject/save on fixture cards
- Open a Needs Review card (sparse details)
- Mention evidence / Ask briefly

Do **not** trigger Sheets sync unless a disposable sheet is configured.

## 6. Sheets (15s)

“Optional, explicit sync after approve. Idempotent by Candidate ID. Demo mode
simulates sync and never writes Google.”

## 7. Architecture close (30s)

Native Devpost/Luma adapters + generic custom adapter + batch persistence +
Terminal event polling. Dry-run = zero candidate writes.

## 8. Closing value (15s)

Broad recall, strict filtering, evidence, reusable custom crawling — self-hosted
for a single operator.

---

## Demo command set

| Intent | Command |
| --- | --- |
| Fast Toronto | `find upcoming hackathons in Toronto --profile light --dry-run` |
| Remote inclusion | `find upcoming AI hackathons in Toronto or remote in the next 6 months --profile light --dry-run` |
| San Francisco | `find upcoming hackathons in San Francisco --profile light --dry-run` |
| Custom source | `find upcoming hackathons from Reskilll in the next 12 months --profile deep --dry-run` |
| Broad deep | `find remote AI hackathons in the next 6 months --profile deep --dry-run` |

CLI form:

```bash
npm run agent -- "<command without flags>" -- --profile light --dry-run
```
