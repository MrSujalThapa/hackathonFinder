export const DEVFOLIO_CONFIG = {
  sourceId: "custom:devfolio" as const,
  listingUrl: "https://devfolio.co/hackathons",
  allowedHostname: "devfolio.co",
  individualPathPattern: /^\/(?:hackathons\/)?[a-z0-9][a-z0-9-]+(?:\/)?$/i,
  rejectedPaths: new Set([
    "/",
    "/hackathons",
    "/hackathons/open",
    "/hackathons/upcoming",
    "/hackathons/past",
    "/organize",
    "/organize-a-hackathon",
  ]),
  openStatusPattern: /\b(open|upcoming|live|accepting|applications open|registrations open)\b/i,
  pastStatusPattern: /\b(past|closed|ended|completed|archived)\b/i,
  nonEventTitlePattern: /^(open|past|upcoming|open hackathons?|past hackathons?|upcoming hackathons?|organize a hackathon|hackathons?)$/i,
};

export function isAllowedDevfolioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === DEVFOLIO_CONFIG.allowedHostname;
  } catch {
    return false;
  }
}
