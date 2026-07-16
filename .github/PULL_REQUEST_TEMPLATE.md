## Summary

-

## Test plan

- [ ] `npm run env:check`
- [ ] `npm run typecheck`
- [ ] `npm test` (and scraper/integration suites if touched)
- [ ] `npm run build`
- [ ] Manual check notes (dry-run / Queue / Terminal) if UI or discovery changed

## Architecture notes

- [ ] No hostname-specific custom scraper without approval
- [ ] No CAPTCHA/WAF bypass
- [ ] No secrets / `.env` / service-account JSON included
- [ ] Tests protect production contracts (not historical phases)

## Screenshots / telemetry

Redact secrets. Prefer dry-run evidence for discovery changes.
