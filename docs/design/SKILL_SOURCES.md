# Agent skill sources

Portable, repository-scoped skills for Cursor, Codex, Claude Code, and similar harnesses.

## Why these skills

| Group | Skills | Why selected |
|-------|--------|--------------|
| Design | `impeccable`, `editorial`, `clean` | Compact, modular design-system guidance with both `SKILL.md` and `DESIGN.md`, useful for deliberate UI refinement without pulling an entire design catalog. |
| Motion | `gsap-core`, `gsap-react`, `gsap-timeline`, `gsap-performance` | Official GreenSock skills matching libraries already used in this app (`gsap`, `@gsap/react`). Kept separate so agents load only the needed surface. |
| Testing | `webapp-testing` | Playwright-oriented local webapp testing helpers for harness automation, without bundling unrelated Codex skills. |

## Source table

| Skill | Source repo | Source path | Commit | License | Files vendored |
|-------|-------------|-------------|--------|---------|----------------|
| impeccable | https://github.com/bergside/awesome-design-skills | skills/impeccable | `f631a09b4fcc0166f2e2c1a8c81906ef680c57e8` | MIT | `SKILL.md`, `DESIGN.md`, `LICENSE`, `SOURCE.json` |
| editorial | https://github.com/bergside/awesome-design-skills | skills/editorial | `f631a09b4fcc0166f2e2c1a8c81906ef680c57e8` | MIT | `SKILL.md`, `DESIGN.md`, `LICENSE`, `SOURCE.json` |
| clean | https://github.com/bergside/awesome-design-skills | skills/clean | `f631a09b4fcc0166f2e2c1a8c81906ef680c57e8` | MIT | `SKILL.md`, `DESIGN.md`, `LICENSE`, `SOURCE.json` |
| gsap-core | https://github.com/greensock/gsap-skills | skills/gsap-core | `aed9cfd3277740755f6bfc1155c7aa645403b760` | MIT | `SKILL.md`, `LICENSE`, `SOURCE.json` |
| gsap-react | https://github.com/greensock/gsap-skills | skills/gsap-react | `aed9cfd3277740755f6bfc1155c7aa645403b760` | MIT | `SKILL.md`, `LICENSE`, `SOURCE.json` |
| gsap-timeline | https://github.com/greensock/gsap-skills | skills/gsap-timeline | `aed9cfd3277740755f6bfc1155c7aa645403b760` | MIT | `SKILL.md`, `LICENSE`, `SOURCE.json` |
| gsap-performance | https://github.com/greensock/gsap-skills | skills/gsap-performance | `aed9cfd3277740755f6bfc1155c7aa645403b760` | MIT | `SKILL.md`, `LICENSE`, `SOURCE.json` |
| webapp-testing | https://github.com/ComposioHQ/awesome-codex-skills | webapp-testing | `9c9da64cf1bbea611d43dd14a10788d55369b353` | Apache-2.0 | `SKILL.md`, `LICENSE.txt`, `SCRIPT_AUDIT.md`, `SOURCE.json`, `scripts/with_server.py`, `examples/*.py` |

## Canonical vs generated

| Path | Role |
|------|------|
| `.agents/skills/` | **Canonical** source of truth. Edit / re-vendor here. |
| `.cursor/skills/` | **Generated** Cursor harness copy |
| `.codex/skills/` | **Generated** Codex harness copy |
| `.claude/skills/` | **Generated** Claude Code harness copy |

Generated copies include `.skill-sync-generated.json`. Unrelated skills already present in harness directories are left untouched.

## Commands

```bash
npm run skills:sync
npm run skills:check
```

- `skills:sync` copies only approved skills into the three harness directories, updates previous generated copies, removes stale generated copies of approved skill names that are no longer approved, and prints a summary.
- `skills:check` validates required files, `SOURCE.json` attribution, licenses, script hash pins, and byte-identical harness copies.

## Safe update procedure

1. Identify the upstream commit SHA you want to vendor.
2. Sparse-clone or download **only** the approved skill folder(s).
3. Audit any executable scripts before keeping them; do not run them until reviewed.
4. Replace the corresponding folder under `.agents/skills/<name>/`.
5. Refresh `SOURCE.json` (`sourceCommit`, `vendoredAt`, and `scriptHashes` if scripts changed).
6. Update `scripts/agent-skills-manifest.ts` and this document’s table.
7. Run `npm run skills:sync` then `npm run skills:check`.
8. Commit canonical + generated harness copies together after check passes.

## Script audit (webapp-testing)

See `.agents/skills/webapp-testing/SCRIPT_AUDIT.md`. Helper scripts were inspected and **not executed** during initial vendoring.
