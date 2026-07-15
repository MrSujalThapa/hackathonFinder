/**
 * Hakku connection status for source selection.
 *
 * Consumes browser-profile helpers when present; otherwise returns a safe stub
 * so discovery can skip Hakku with a visible reason (never silent).
 */

import {
  hakkuProfileExists,
  readHakkuSessionMeta,
} from "@/lib/browser/sessionMeta";

export type HakkuConnectionStatus = {
  connected: boolean;
  /** Safe user-visible message — never includes profile paths. */
  safeMessage: string;
};

export type HakkuStatusProvider = {
  getStatus: () => Promise<HakkuConnectionStatus> | HakkuConnectionStatus;
};

let provider: HakkuStatusProvider | null = null;

/** Register Hakku status helpers from browser/profile code when available. */
export function registerHakkuStatusProvider(
  next: HakkuStatusProvider | null,
): void {
  provider = next;
}

export function setHakkuStatusProviderForTests(
  next: HakkuStatusProvider | null,
): void {
  provider = next;
}

export async function getHakkuConnectionStatus(): Promise<HakkuConnectionStatus> {
  if (provider) {
    return provider.getStatus();
  }

  if (process.env.HAKKU_CONNECTED === "true") {
    return { connected: true, safeMessage: "Hakku profile connected" };
  }

  try {
    const meta = readHakkuSessionMeta();
    if (meta?.status === "connected" && hakkuProfileExists()) {
      return { connected: true, safeMessage: "Hakku profile connected" };
    }
    if (meta?.status === "reconnect_required") {
      return {
        connected: false,
        safeMessage: "Hakku session expired — reconnect the browser profile",
      };
    }
    if (!hakkuProfileExists()) {
      return {
        connected: false,
        safeMessage:
          "Hakku disconnected — connect a browser profile before including this source",
      };
    }
  } catch {
    // Fall through to disconnected.
  }

  return {
    connected: false,
    safeMessage:
      "Hakku disconnected — connect a browser profile before including this source",
  };
}
