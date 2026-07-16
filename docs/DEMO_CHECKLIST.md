# Demo checklist

## Before demo

- [ ] Pull the release branch / tagged commit you intend to show
- [ ] Confirm `.env.local` exists and is **not** shared on screen
- [ ] `npm run env:check`
- [ ] `npm run build`
- [ ] `npm run start` (or `npm run dev` if explicitly demoing dev)
- [ ] Confirm login with `APP_PASSWORD`
- [ ] Confirm Terminal loads
- [ ] Run one dry-run smoke: Toronto light
- [ ] Confirm Queue loads with real Supabase data (`DEMO_MODE` / `USE_MOCK_CANDIDATES` off)
- [ ] Keep `DEMO_MODE=true` only as a last-resort Queue fallback if live data fails
- [ ] Close unnecessary terminals / browser tabs
- [ ] Disable noisy notifications
- [ ] Stable network + power
- [ ] Keep fallback lines ready (Luma slow / OpenAI down / blocked source / network fail)

## During demo

- [ ] Do not open `.env.local` or raw logs with tokens
- [ ] Prefer `--dry-run` and `light` profile
- [ ] Do not trigger broad persistence
- [ ] Do not run exhaustive/`deep` unless necessary — warn about duration
- [ ] Do not sync Sheets unless disposable + configured

## After demo

- [ ] Confirm no accidental write runs (dry-run / demo mode)
- [ ] Rotate credentials if anything was exposed on stream
- [ ] Stop the server if appropriate
