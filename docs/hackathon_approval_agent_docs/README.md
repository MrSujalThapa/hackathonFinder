# Hackathon Approval Agent Docs

This folder contains the planning docs for a mobile-first hackathon discovery approval agent.

## Files

1. `01_PRD.md` — product requirements, user flows, MVP scope, acceptance criteria.
2. `02_SYSTEM_ARCHITECTURE.md` — system design, agent workflow, deployment model, source integration strategy.
3. `03_API_SPEC.md` — frontend/backend API routes, request/response contracts, CLI commands.
4. `04_DATABASE_SCHEMA.md` — Supabase/Postgres schema, indexes, dedupe strategy, RLS notes.
5. `05_PROJECT_PLAN.md` — implementation plan using the requested main-step/substep format, with commits after every substep and merges at the end of each main step.
6. `06_CURSOR_PROMPTS.md` — initial Cursor prompt plus step-by-step prompts.
7. `07_DESIGN_UX_SPEC.md` — Tinder-style mobile UI/UX spec, card states, animations, and design constraints.

## Product Summary

The agent discovers hackathons from HackList, Hakku, Devpost, MLH, Luma, web search, X/Twitter MCP, and manual social leads. It does not directly write everything to Google Sheets. Instead, it creates an approval queue. The user reviews each hackathon in a mobile-first Tinder-style interface, then approves, rejects, saves for later, or asks the agent to find more information. Approved hackathons are appended to Google Sheets. Rejected and saved candidates remain stored so the user can revisit them later.
