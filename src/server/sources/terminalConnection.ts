import type { Page } from "playwright";
import { HAKKU_SWIPE_URL, probeHakkuAuth } from "@/collectors/hakku";
import { readDiscoveryRuntimeConfig } from "@/discovery/config";
import { acquireSourceLock } from "@/discovery/sourceLocks";
import { detectHakkuAuth, type HakkuAuthStatus } from "@/lib/browser/hakkuAuth";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  resolveHakkuProfileDir,
  withPersistentPlaywright,
} from "@/lib/browser/playwright";
import {
  hakkuProfileExists,
  readHakkuSessionMeta,
  removeOrArchiveSourceProfile,
  writeHakkuSessionMeta,
} from "@/lib/browser/sessionMeta";
import { resolveHakkuProfileName } from "@/lib/browser/profilePaths";
import {
  SOURCE_CAPABILITIES,
  SOURCE_DISPLAY_NAMES,
} from "@/lib/sources/config";
import {
  checkSourceHealth,
  recordSourceHealth,
} from "@/lib/sources";
import type {
  HealthableSourceName,
  SourceHealth,
  SourceHealthStatus,
} from "@/lib/sources/types";

export type TerminalSourceLevel = "info" | "success" | "warning" | "error";

export type TerminalSourceLine = {
  level: TerminalSourceLevel;
  text: string;
};

export type TerminalSourceResult = {
  lines: TerminalSourceLine[];
  confirmationRequired?: boolean;
  expiresAt?: string;
};

type TerminalSourceContext = {
  sessionId: string;
  now?: Date;
  onLine?: (line: TerminalSourceLine) => void | Promise<void>;
};

type PendingDisconnect = {
  sessionId: string;
  source: HealthableSourceName;
  expiresAt: number;
};

const DISCONNECT_CONFIRM_TTL_MS = 2 * 60_000;
const pendingDisconnects = new Map<string, PendingDisconnect>();

export type TerminalSourceTestHooks = {
  connectHakku?: (
    emit: (line: TerminalSourceLine) => Promise<void>,
  ) => Promise<TerminalSourceResult>;
  checkHakku?: (
    emit: (line: TerminalSourceLine) => Promise<void>,
  ) => Promise<TerminalSourceResult>;
};

let testHooks: TerminalSourceTestHooks | null = null;

export function setTerminalSourceConnectionHooksForTests(
  hooks: TerminalSourceTestHooks | null,
): void {
  testHooks = hooks;
  pendingDisconnects.clear();
}

async function collectLines(
  context: TerminalSourceContext,
  fn: (emit: (line: TerminalSourceLine) => Promise<void>) => Promise<void>,
): Promise<TerminalSourceResult> {
  const lines: TerminalSourceLine[] = [];
  const emit = async (line: TerminalSourceLine) => {
    lines.push(line);
    await context.onLine?.(line);
  };
  await fn(emit);
  return { lines };
}

function confirmationKey(sessionId: string, source: HealthableSourceName): string {
  return `${sessionId}:${source}`;
}

function sourceTag(source: HealthableSourceName): string {
  return `[${source}]`;
}

function boolLabel(value: boolean): string {
  return value ? "yes" : "no";
}

function displayConnectionStatus(source: HealthableSourceName): string {
  if (source === "hakku") {
    const meta = readHakkuSessionMeta();
    const profileExists = hakkuProfileExists();
    if (meta?.status === "connected" && profileExists) return "Connected";
    if (meta?.status === "reconnect_required") return "Reconnect required";
    if (!profileExists || meta?.status === "profile_missing") return "Not connected";
    return "Connection unknown";
  }
  if (source === "luma") return "Public mode";
  return "Public source";
}

function safeFailureReason(source: HealthableSourceName): string | null {
  if (source === "hakku") {
    const meta = readHakkuSessionMeta();
    if (!hakkuProfileExists() || meta?.status === "profile_missing") {
      return "Saved browser session is missing.";
    }
    if (meta?.status === "reconnect_required") {
      return "Saved browser session redirects to login.";
    }
    if (!meta || meta.status === "unknown") {
      return "Saved browser session has not been verified yet.";
    }
  }
  if (source === "luma") {
    return "Authenticated Luma connector is unavailable; public mode remains enabled.";
  }
  return null;
}

export async function getTerminalSourceStatus(
  source: HealthableSourceName,
  context: TerminalSourceContext,
): Promise<TerminalSourceResult> {
  return collectLines(context, async (emit) => {
    const capabilities = SOURCE_CAPABILITIES[source];
    const meta = source === "hakku" ? readHakkuSessionMeta() : null;
    await emit({
      level: source === "hakku" && !hakkuProfileExists() ? "warning" : "info",
      text: `${sourceTag(source)} Status: ${displayConnectionStatus(source)}`,
    });
    await emit({
      level: "info",
      text: `${sourceTag(source)} Last verified: ${meta?.lastVerifiedAt ?? "never"}`,
    });
    await emit({
      level: "info",
      text: `${sourceTag(source)} Persistent session mode: ${boolLabel(
        capabilities.browserRequired,
      )}`,
    });
    await emit({
      level: capabilities.browserRequired ? "warning" : "info",
      text: `${sourceTag(source)} Browser required: ${boolLabel(
        capabilities.browserRequired,
      )}`,
    });
    const reason = safeFailureReason(source);
    if (reason) {
      await emit({
        level: source === "hakku" ? "warning" : "info",
        text: `${sourceTag(source)} Safe failure reason: ${reason}`,
      });
    }
  });
}

function sourceHealthFromHakkuProbe(
  status: HakkuAuthStatus,
  checkedAt: string,
): SourceHealth {
  const source = "hakku";
  let healthStatus: SourceHealthStatus = "auth_required";
  let connectionStatus: SourceHealth["connectionStatus"] = "unknown";
  let safeMessage = "Hakku connection status is unknown.";
  let failureCategory: SourceHealth["failureCategory"] = "unknown";

  if (status === "authenticated") {
    healthStatus = "healthy";
    connectionStatus = "connected";
    safeMessage = "Hakku browser session is authenticated.";
    failureCategory = undefined;
  } else if (status === "login_required") {
    healthStatus = "auth_required";
    connectionStatus = "reconnect_required";
    safeMessage = "Hakku browser session redirects to login.";
    failureCategory = "session_expired";
  }

  return {
    source,
    displayName: SOURCE_DISPLAY_NAMES[source],
    status: healthStatus,
    enabled: true,
    authenticated: status === "authenticated",
    lastCheckedAt: checkedAt,
    lastSuccessfulAt: status === "authenticated" ? checkedAt : undefined,
    failureCategory,
    safeMessage,
    capabilities: SOURCE_CAPABILITIES[source],
    connectionStatus,
    mode: status === "authenticated" ? "authenticated" : "unconfigured",
  };
}

async function collectPageSignals(page: Page): Promise<{
  url: string;
  title: string;
  bodyText: string;
  hasSwipeCards: boolean;
  hasPasswordField: boolean;
}> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 8_000);
  const hasPasswordField =
    (await page.locator("input[type='password']").count().catch(() => 0)) > 0;
  const hasSwipeCards =
    (await page
      .locator("[data-testid='swipe-card'], article.card, .swipe-card, [class*='SwipeCard']")
      .count()
      .catch(() => 0)) > 0;

  return { url, title, bodyText, hasSwipeCards, hasPasswordField };
}

function readConnectTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.HAKKU_CONNECT_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 60_000;
}

async function connectHakku(
  context: TerminalSourceContext,
): Promise<TerminalSourceResult> {
  if (testHooks?.connectHakku) {
    return testHooks.connectHakku(async (line) => {
      await context.onLine?.(line);
    });
  }

  const config = readDiscoveryRuntimeConfig();
  if (config.executionMode === "worker") {
    return collectLines(context, async (emit) => {
      await emit({
        level: "warning",
        text: "[hakku] Worker-host connection required.",
      });
      await emit({
        level: "warning",
        text: "[hakku] Remote connection from the web process is unsupported.",
      });
      await emit({
        level: "warning",
        text: "[hakku] Remote browser connector unavailable.",
      });
    });
  }

  return collectLines(context, async (emit) => {
    let release: (() => void) | undefined;
    try {
      release = await acquireSourceLock({
        source: "hakku",
        onWaiting: async () => {
          await emit({
            level: "info",
            text: "[hakku] Waiting for Hakku profile lock...",
          });
        },
      });

      await emit({
        level: "info",
        text: "[hakku] Opening persistent browser session...",
      });

      const timeoutMs = readConnectTimeoutMs();
      const pollMs = 2_500;
      const profileDir = resolveHakkuProfileDir();

      await withPersistentPlaywright(
        profileDir,
        async ({ page }) => {
          await page.goto(HAKKU_SWIPE_URL, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          await emit({
            level: "info",
            text: "[hakku] Waiting for manual sign-in...",
          });

          const deadline = Date.now() + timeoutMs;
          let lastStatus: HakkuAuthStatus = "unknown";

          while (Date.now() < deadline) {
            const auth = detectHakkuAuth(await collectPageSignals(page));
            lastStatus = auth;
            if (auth === "authenticated") {
              writeHakkuSessionMeta("connected");
              recordSourceHealth(sourceHealthFromHakkuProbe(auth, new Date().toISOString()));
              await emit({ level: "success", text: "[hakku] Authentication detected." });
              await emit({ level: "success", text: "[hakku] Session saved." });
              await emit({ level: "success", text: "[hakku] Connected." });
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, pollMs));
          }

          writeHakkuSessionMeta(lastStatus === "login_required" ? "reconnect_required" : "unknown");
          recordSourceHealth(sourceHealthFromHakkuProbe(lastStatus, new Date().toISOString()));
          await emit({ level: "warning", text: "[hakku] Login was not completed." });
          await emit({
            level: "warning",
            text: "[hakku] Connection status remains Not connected.",
          });
        },
        { headless: false, timeoutMs: 30_000 },
      );
    } catch (error) {
      if (isPlaywrightBrowserMissingError(error)) {
        await emit({ level: "error", text: `[hakku] ${formatPlaywrightInstallHint()}` });
      } else {
        await emit({
          level: "error",
          text: `[hakku] ${error instanceof Error ? error.message : "Connection failed."}`,
        });
      }
    } finally {
      release?.();
    }
  });
}

async function checkHakku(
  context: TerminalSourceContext,
): Promise<TerminalSourceResult> {
  if (testHooks?.checkHakku) {
    return testHooks.checkHakku(async (line) => {
      await context.onLine?.(line);
    });
  }

  return collectLines(context, async (emit) => {
    if (!hakkuProfileExists()) {
      writeHakkuSessionMeta("profile_missing");
      recordSourceHealth({
        source: "hakku",
        displayName: SOURCE_DISPLAY_NAMES.hakku,
        status: "auth_required",
        enabled: true,
        authenticated: false,
        lastCheckedAt: new Date().toISOString(),
        failureCategory: "profile_missing",
        safeMessage: "Hakku browser profile is missing.",
        capabilities: SOURCE_CAPABILITIES.hakku,
        connectionStatus: "not_connected",
        mode: "unconfigured",
      });
      await emit({ level: "warning", text: "[hakku] Profile missing." });
      await emit({ level: "warning", text: "[hakku] Connection status: Not connected." });
      return;
    }

    let release: (() => void) | undefined;
    try {
      release = await acquireSourceLock({
        source: "hakku",
        onWaiting: async () => {
          await emit({ level: "info", text: "[hakku] Waiting for Hakku profile lock..." });
        },
      });
      await emit({ level: "info", text: "[hakku] Inspecting saved browser session..." });
      const probe = await probeHakkuAuth({
        profileDir: resolveHakkuProfileDir(),
        timeoutMs: 20_000,
        headless: true,
        captureFailure: false,
      });
      const status =
        probe.authStatus === "authenticated"
          ? "connected"
          : probe.authStatus === "login_required"
            ? "reconnect_required"
            : "unknown";
      writeHakkuSessionMeta(status);
      recordSourceHealth(sourceHealthFromHakkuProbe(probe.authStatus, new Date().toISOString()));
      await emit({
        level: status === "connected" ? "success" : "warning",
        text:
          status === "connected"
            ? "[hakku] Connected."
            : status === "reconnect_required"
              ? "[hakku] Reconnect required."
              : "[hakku] Connection unknown.",
      });
    } catch (error) {
      await emit({
        level: "error",
        text: isPlaywrightBrowserMissingError(error)
          ? `[hakku] ${formatPlaywrightInstallHint()}`
          : `[hakku] ${error instanceof Error ? error.message : "Status check failed."}`,
      });
    } finally {
      release?.();
    }
  });
}

async function checkLuma(
  context: TerminalSourceContext,
): Promise<TerminalSourceResult> {
  return collectLines(context, async (emit) => {
    const health = await checkSourceHealth("luma", { live: true, persist: true });
    await emit({
      level: health.status === "failed" ? "warning" : "info",
      text: `[luma] ${health.status.replace(/_/g, " ")} - ${
        health.safeMessage ??
        "Public mode available. Authenticated connection is unsupported."
      }`,
    });
  });
}

export async function checkTerminalSource(
  source: HealthableSourceName,
  context: TerminalSourceContext,
): Promise<TerminalSourceResult> {
  if (source === "hakku") return checkHakku(context);
  if (source === "luma") return checkLuma(context);
  return collectLines(context, async (emit) => {
    const health = await checkSourceHealth(source, { live: true, persist: true });
    await emit({
      level: health.status === "failed" ? "error" : "info",
      text: `${sourceTag(source)} ${health.status.replace(/_/g, " ")}${
        health.safeMessage ? ` - ${health.safeMessage}` : ""
      }`,
    });
  });
}

export async function connectTerminalSource(
  source: HealthableSourceName,
  context: TerminalSourceContext,
): Promise<TerminalSourceResult> {
  if (source === "hakku") return connectHakku(context);
  if (source === "luma") {
    return collectLines(context, async (emit) => {
      await emit({
        level: "info",
        text: "[luma] Public mode is available without authentication.",
      });
      await emit({
        level: "warning",
        text: "[luma] Authenticated browser connection is not implemented.",
      });
    });
  }
  return collectLines(context, async (emit) => {
    await emit({
      level: "info",
      text: `${sourceTag(source)} No authenticated connection is required for ${SOURCE_DISPLAY_NAMES[source]}.`,
    });
  });
}

export async function requestTerminalSourceDisconnect(
  source: HealthableSourceName,
  context: TerminalSourceContext,
): Promise<TerminalSourceResult> {
  const expiresAt = (context.now ?? new Date()).getTime() + DISCONNECT_CONFIRM_TTL_MS;
  pendingDisconnects.set(confirmationKey(context.sessionId, source), {
    sessionId: context.sessionId,
    source,
    expiresAt,
  });

  return {
    lines: [
      {
        level: "warning",
        text: `Disconnect ${SOURCE_DISPLAY_NAMES[source]} and remove its saved browser session?`,
      },
      {
        level: "info",
        text: "Run:",
      },
      {
        level: "info",
        text: `/confirm disconnect ${source}`,
      },
    ],
    confirmationRequired: true,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function confirmTerminalSourceDisconnect(
  source: HealthableSourceName,
  context: TerminalSourceContext,
): Promise<TerminalSourceResult> {
  const key = confirmationKey(context.sessionId, source);
  const pending = pendingDisconnects.get(key);
  const now = (context.now ?? new Date()).getTime();
  if (!pending || pending.expiresAt <= now) {
    pendingDisconnects.delete(key);
    return {
      lines: [
        {
          level: "warning",
          text: `${sourceTag(source)} Disconnect confirmation expired. Run /source disconnect ${source} again.`,
        },
      ],
    };
  }
  pendingDisconnects.delete(key);

  if (source !== "hakku") {
    return {
      lines: [
        {
          level: "info",
          text: `${sourceTag(source)} No saved browser session exists for this source.`,
        },
      ],
    };
  }

  return collectLines(context, async (emit) => {
    let release: (() => void) | undefined;
    try {
      release = await acquireSourceLock({
        source: "hakku",
        onWaiting: async () => {
          await emit({ level: "info", text: "[hakku] Waiting for Hakku profile lock..." });
        },
      });
      await emit({ level: "info", text: "[hakku] Removing saved browser session..." });
      removeOrArchiveSourceProfile(resolveHakkuProfileName(), { archive: false });
      writeHakkuSessionMeta("profile_missing");
      recordSourceHealth({
        source: "hakku",
        displayName: SOURCE_DISPLAY_NAMES.hakku,
        status: "auth_required",
        enabled: true,
        authenticated: false,
        lastCheckedAt: new Date().toISOString(),
        failureCategory: "profile_missing",
        safeMessage: "Hakku browser profile is missing.",
        capabilities: SOURCE_CAPABILITIES.hakku,
        connectionStatus: "not_connected",
        mode: "unconfigured",
      });
      await emit({ level: "success", text: "[hakku] Disconnected. Saved session removed." });
    } catch (error) {
      await emit({
        level: "error",
        text: `[hakku] ${error instanceof Error ? error.message : "Disconnect failed."}`,
      });
    } finally {
      release?.();
    }
  });
}
