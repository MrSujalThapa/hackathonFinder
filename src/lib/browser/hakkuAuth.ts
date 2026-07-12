export type HakkuAuthStatus = "authenticated" | "login_required" | "unknown";

export type HakkuPageSignals = {
  url: string;
  title?: string;
  bodyText: string;
  hasSwipeCards: boolean;
  hasPasswordField?: boolean;
};

const LOGIN_URL_RE = /\/(login|signin|sign-in|auth|welcome)(\/|$|\?)/i;
const LOGIN_COPY_RE =
  /welcome back|enter your credentials|sign in with|forgot\s*\?|create an account|continue with google|continue with github/i;
const AUTH_UI_RE = /swipe|hackathon|prize|apply|deadline|upcoming|matches|pass|like/i;

/**
 * Pure auth detection from page signals — used by collector, connect, and status.
 * Never inspects cookies or storage state.
 */
export function detectHakkuAuth(signals: HakkuPageSignals): HakkuAuthStatus {
  const url = signals.url.trim();
  const body = signals.bodyText.toLowerCase();
  const title = (signals.title ?? "").toLowerCase();

  const urlLooksLikeLogin = LOGIN_URL_RE.test(url);
  const copyLooksLikeLogin =
    LOGIN_COPY_RE.test(body) ||
    LOGIN_COPY_RE.test(title) ||
    (Boolean(signals.hasPasswordField) && /password|credentials|sign in/i.test(body));

  if (signals.hasSwipeCards && !urlLooksLikeLogin) {
    return "authenticated";
  }

  if (urlLooksLikeLogin || (copyLooksLikeLogin && !AUTH_UI_RE.test(body))) {
    return "login_required";
  }

  if (copyLooksLikeLogin && signals.hasPasswordField) {
    return "login_required";
  }

  // Authenticated-looking feed text without explicit login chrome.
  if (AUTH_UI_RE.test(body) && !copyLooksLikeLogin && !urlLooksLikeLogin) {
    return "authenticated";
  }

  return "unknown";
}

export function isLikelyPastHakkuCard(card: {
  title: string;
  text?: string;
  tags: string[];
}): boolean {
  const haystack = [card.title, card.text ?? "", ...card.tags].join(" ").toLowerCase();
  if (/\b(ended|past|closed|completed|finished|archived)\b/.test(haystack)) {
    return true;
  }
  // Year tags that are clearly historical relative to "now" are filtered by caller when needed.
  return false;
}

export function filterUpcomingHakkuCards<T extends { title: string; text?: string; tags: string[] }>(
  cards: T[],
): T[] {
  return cards.filter((card) => !isLikelyPastHakkuCard(card));
}

export type HakkuStopReason =
  | "completed"
  | "auth_required"
  | "timeout"
  | "no_cards"
  | "profile_missing"
  | "browser_missing"
  | "error";

export type HakkuCollectMode = "authenticated" | "public" | "unauthenticated";
