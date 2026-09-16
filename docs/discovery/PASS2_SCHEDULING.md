# Pass 2 scheduling

HackFinder workers are one-shot processes. They must be invoked by a platform scheduler; they never keep an agent alive waiting for work.

Suggested deployment schedules:

- Discovery: `npm run worker:discovery:once` two to four times daily.
- Application tracker: `npm run worker:applications:once` hourly.
- Discord Gateway: `npm run worker:discord` only on the trusted local host while interactive Discord control is wanted.

The application tracker acts only on approved/interested opportunities. It may prepare a draft when an approved application opens, but it never submits an external form. External submission remains disabled except for the controlled local fixture used by automated verification.

Platform scheduling, persistent worker hosting, and real-site browser-session storage are deployment concerns; no deployment is required for local Pass 2 verification.
