# Security Policy

## Supported versions

Security fixes are accepted against the default branch (`main`) of this repository.
There is no separate LTS track for this self-hosted application.

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public GitHub issue for
credential leaks, auth bypasses, or remote code execution.

Preferred options:

1. **GitHub private vulnerability reporting** on this repository (Security tab →
   Advisories → Report a vulnerability), when enabled.
2. If private reporting is unavailable, open a **draft** security advisory or
   contact the repository owner through GitHub without pasting secrets.

### What to include

- Affected commit or release tag
- Impact summary (auth bypass, secret exposure, SSRF, XSS, etc.)
- Reproduction steps that do **not** target third-party infrastructure you do not own
- Whether credentials or personal data were exposed
- Suggested remediation, if known

### What not to include

- Live production secrets, session cookies, or full `.env` files
- Personal data of real users beyond what is needed to demonstrate impact

## Expected response

Maintainers will acknowledge actionable reports when possible and prioritize
fixes for exploitable issues in the default branch. There is no guaranteed SLA
for this personal open-source project.

## Out-of-scope testing

Do **not**:

- Test against deployments, Supabase projects, Google Sheets, or APIs you do not own
- Bypass CAPTCHAs, WAFs, or authentication on third-party hackathon platforms
- Use this project’s collectors to attack or scrape non-public authenticated data
  without authorization

## Exposed credentials

If you discover a committed or leaked secret:

1. Report it privately.
2. Assume the secret is compromised even if the file was later deleted.
3. Rotate/revoke the credential at the provider.
4. Do not assume git history is clean unless an explicit history rewrite was
   performed and coordinated.

Application operators should keep secrets in `.env.local` (gitignored), never
prefix secrets with `NEXT_PUBLIC_`, and run `npm run env:check` / `npm run secrets:scan`
before publishing changes.
