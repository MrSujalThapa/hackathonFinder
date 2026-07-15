import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  HEALTHABLE_SOURCES,
  type HealthableSourceName,
  type SourceHealth,
  type SourceSettingsState,
} from "@/lib/sources/types";
import { defaultEnabledMap } from "@/lib/sources/config";

const SETTINGS_RELATIVE = path.join(".data", "source-settings.json");

function settingsPath(cwd = process.cwd()): string {
  return path.resolve(cwd, SETTINGS_RELATIVE);
}

function emptyState(
  env: Record<string, string | undefined> = process.env,
): SourceSettingsState {
  return {
    enabled: defaultEnabledMap(env),
    lastSuccessfulAt: {},
    lastHealth: {},
  };
}

function normalizeState(
  raw: Partial<SourceSettingsState> | null | undefined,
  env: Record<string, string | undefined> = process.env,
): SourceSettingsState {
  const base = emptyState(env);
  if (!raw || typeof raw !== "object") return base;

  for (const source of HEALTHABLE_SOURCES) {
    const value = raw.enabled?.[source];
    if (typeof value === "boolean") {
      base.enabled[source] = value;
    }
  }

  if (raw.lastSuccessfulAt && typeof raw.lastSuccessfulAt === "object") {
    for (const source of HEALTHABLE_SOURCES) {
      const stamp = raw.lastSuccessfulAt[source];
      if (typeof stamp === "string" && stamp.length > 0) {
        base.lastSuccessfulAt[source] = stamp;
      }
    }
  }

  if (raw.lastHealth && typeof raw.lastHealth === "object") {
    for (const source of HEALTHABLE_SOURCES) {
      const health = raw.lastHealth[source];
      if (health && health.source === source) {
        base.lastHealth[source] = health;
      }
    }
  }

  return base;
}

export function readSourceSettings(
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): SourceSettingsState {
  const file = settingsPath(cwd);
  if (!existsSync(file)) return emptyState(env);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SourceSettingsState>;
    return normalizeState(parsed, env);
  } catch {
    return emptyState(env);
  }
}

export function writeSourceSettings(
  state: SourceSettingsState,
  cwd = process.cwd(),
): void {
  const file = settingsPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function updateSourceEnabled(
  updates: Partial<Record<HealthableSourceName, boolean>>,
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): SourceSettingsState {
  const state = readSourceSettings(cwd, env);
  for (const source of HEALTHABLE_SOURCES) {
    if (typeof updates[source] === "boolean") {
      state.enabled[source] = updates[source]!;
    }
  }
  writeSourceSettings(state, cwd);
  return state;
}

export function recordSourceHealth(
  health: SourceHealth,
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): SourceSettingsState {
  const state = readSourceSettings(cwd, env);
  state.lastHealth[health.source] = health;
  if (health.status === "healthy" || health.status === "degraded") {
    if (health.lastSuccessfulAt) {
      state.lastSuccessfulAt[health.source] = health.lastSuccessfulAt;
    } else if (
      health.status === "healthy" ||
      (health.leadsFound != null && health.leadsFound > 0)
    ) {
      state.lastSuccessfulAt[health.source] = health.lastCheckedAt;
    }
  }
  writeSourceSettings(state, cwd);
  return state;
}

export function getEnabledSources(
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): HealthableSourceName[] {
  const state = readSourceSettings(cwd, env);
  return HEALTHABLE_SOURCES.filter((source) => state.enabled[source]);
}
