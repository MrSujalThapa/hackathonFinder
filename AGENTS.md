# AGENTS.md

## Project

Hackathon Finder is a private hackathon discovery and review workspace.

Core workflow:

1. Discover hackathons through collectors and the agent planner.
2. Normalize, verify, classify, score, and deduplicate candidates.
3. Store candidates and evidence in Supabase.
4. Review candidates in the web app.
5. Approve, reject, save, restore, or investigate candidates.
6. Sync approved candidates to Google Sheets.

Preserve this workflow unless the task explicitly requires architectural changes.

---

## Execution Rules

- Prefer one primary agent.
- Do not use subagents by default.
- Use subagents only when work is tightly scoped, non-overlapping, independently testable, and clearly saves time or context.
- The primary agent owns architecture, integration, testing, commits, and final review.
- Do not use X or run `--sources=x` unless explicitly requested.
- Do not deploy unless explicitly requested.
- Do not apply database migrations without explicit approval.
- Do not perform unrelated refactors.
- Keep changes scoped to the requested phase.
- Preserve existing behavior unless the task explicitly changes it.
- Commit after each meaningful, independently valid step.
- Stop and report when the requested scope is complete.

---

## Repository Skills

Canonical project skills are stored in:

```text
.agents/skills/