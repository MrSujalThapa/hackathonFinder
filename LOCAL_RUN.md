# HackFinder local-first operation

HackFinder v1 runs on this laptop. Start the local web app, Discord gateway, and scheduled one-shot workers together with:

```powershell
npm run hackfinder
```

The supervisor starts the web app only if it is not already serving locally, starts the Discord Gateway only when its complete configuration is present, runs a discovery worker pass every six hours, and runs the application tracker hourly. Ctrl+C stops only services started by this supervisor. The intervals can be adjusted for a local test through `HACKFINDER_DISCOVERY_INTERVAL_MS` and `HACKFINDER_TRACKER_INTERVAL_MS`.

Check the expected configuration and local web health without printing secrets:

```powershell
npm run hackfinder:status
```

`APP_BASE_URL` must be the private HTTPS Tailscale Serve URL. External links in Discord and notifications are constructed from that setting; no hostname is embedded in source code. Do not use Tailscale Funnel for HackFinder.

For phone access, the laptop must be powered on, connected to the internet, awake, running the HackFinder runtime, and connected to Tailscale. The screen can be off. Sleep, hibernation, shutdown, or a stopped runtime makes the service unavailable.

Optional Windows setup (make these choices yourself):

- While plugged in, configure Windows power settings to avoid sleeping if you need unattended access.
- Enable Tailscale's Run Unattended option if the machine needs to remain reachable before you sign in.
- Add `npm run hackfinder` to a login/startup task if you want it to start automatically.

None of these operating-system settings are changed by HackFinder.
