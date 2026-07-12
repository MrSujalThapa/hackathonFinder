# Script audit — webapp-testing

Audited before vendoring. **None of these scripts were executed** during setup.

| File | Purpose | Risk notes | Kept |
|------|---------|------------|------|
| `scripts/with_server.py` | Starts one or more local servers (`subprocess` + `shell=True`), polls `localhost` ports until ready, runs a follow-up command, then terminates servers. | Intentionally runs user-supplied shell commands; localhost-only readiness check; no network exfiltration or credential handling. | Yes — required by `SKILL.md` |
| `examples/console_logging.py` | Playwright example that captures browser console messages. | Example only; hard-codes a local URL; writes logs under `/mnt/user-data/outputs/` (Codex sandbox path). | Yes — referenced by `SKILL.md` |
| `examples/element_discovery.py` | Playwright example for discovering buttons/links/inputs. | Example only. | Yes — referenced by `SKILL.md` |
| `examples/static_html_automation.py` | Playwright example using `file://` URLs for static HTML. | Example only. | Yes — referenced by `SKILL.md` |

## Exclusions

No other files existed under `webapp-testing/` upstream beyond `SKILL.md`, `LICENSE.txt`, `scripts/`, and `examples/`. Nothing else was vendored.

## Hash pins

Executable and example Python files are pinned via `SOURCE.json` → `scriptHashes` and verified by `npm run skills:check`.
