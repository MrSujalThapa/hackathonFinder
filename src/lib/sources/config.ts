import {
  HEALTHABLE_SOURCES,
  type HealthableSourceName,
  type SourceCapabilities,
  type SourceDiscoveryMode,
} from "@/lib/sources/types";

export const SOURCE_DISPLAY_NAMES: Record<HealthableSourceName, string> = {
  mlh: "MLH",
  web: "Web",
  hacklist: "HackList",
  devpost: "Devpost",
  luma: "Luma",
  hakku: "Hakku",
};

export const SOURCE_CAPABILITIES: Record<HealthableSourceName, SourceCapabilities> = {
  mlh: {
    publicDiscovery: true,
    authenticatedDiscovery: false,
    browserRequired: false,
  },
  web: {
    publicDiscovery: true,
    authenticatedDiscovery: false,
    browserRequired: false,
  },
  hacklist: {
    publicDiscovery: true,
    authenticatedDiscovery: false,
    browserRequired: false,
  },
  devpost: {
    publicDiscovery: true,
    authenticatedDiscovery: false,
    browserRequired: false,
  },
  luma: {
    publicDiscovery: true,
    authenticatedDiscovery: false,
    browserRequired: false,
  },
  hakku: {
    publicDiscovery: false,
    authenticatedDiscovery: true,
    browserRequired: true,
  },
};

/** Sources enabled by default when no override is set. */
export const DEFAULT_SOURCE_ENABLED: Record<HealthableSourceName, boolean> = {
  mlh: true,
  web: true,
  hacklist: true,
  devpost: true,
  luma: true,
  hakku: true,
};

const ENV_ENABLE_KEYS: Record<HealthableSourceName, string> = {
  mlh: "SOURCE_MLH_ENABLED",
  web: "SOURCE_WEB_ENABLED",
  hacklist: "SOURCE_HACKLIST_ENABLED",
  devpost: "SOURCE_DEVPOST_ENABLED",
  luma: "SOURCE_LUMA_ENABLED",
  hakku: "SOURCE_HAKKU_ENABLED",
};

function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (value == null || value.trim() === "") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

/** Resolve enabled flag: file/runtime override → env → default. */
export function resolveSourceEnabled(
  source: HealthableSourceName,
  override?: boolean,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (typeof override === "boolean") return override;
  const fromEnv = parseBoolEnv(env[ENV_ENABLE_KEYS[source]]);
  if (typeof fromEnv === "boolean") return fromEnv;
  return DEFAULT_SOURCE_ENABLED[source];
}

export function defaultEnabledMap(
  env: Record<string, string | undefined> = process.env,
): Record<HealthableSourceName, boolean> {
  const map = {} as Record<HealthableSourceName, boolean>;
  for (const source of HEALTHABLE_SOURCES) {
    map[source] = resolveSourceEnabled(source, undefined, env);
  }
  return map;
}

export function discoveryModeFor(
  source: HealthableSourceName,
  enabled: boolean,
  authenticated?: boolean,
): SourceDiscoveryMode {
  if (!enabled) return "disabled";
  if (source === "web") {
    // Mode refined by caller when search config is known.
    return "public";
  }
  if (source === "hakku") {
    return authenticated ? "authenticated" : "unconfigured";
  }
  if (source === "luma") {
    return "public";
  }
  return "public";
}

export { ENV_ENABLE_KEYS };
