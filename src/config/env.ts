import { z } from "zod";

const optionalUrl = z
  .string()
  .url()
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalString = z
  .string()
  .optional()
  .or(z.literal("").transform(() => undefined));

const emptyToUndefined = z.literal("").transform(() => undefined);

const searchProviderSchema = z
  .enum(["tavily", "brave", "exa", "serpapi", "mock"])
  .optional()
  .or(emptyToUndefined);

const llmProviderSchema = z
  .enum(["openai", "mock"])
  .optional()
  .or(emptyToUndefined);

const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .or(emptyToUndefined)
  .transform((value) => value === "true" || value === "1");

const positiveIntString = optionalString.refine(
  (value) => {
    if (value === undefined) return true;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && Number.isInteger(n);
  },
  { message: "must be a positive integer" },
);

export const CLIENT_SAFE_ENV_PREFIXES = ["NEXT_PUBLIC_"] as const;

/** Variable names that must never appear in client bundles as readable secrets. */
export const SERVER_ONLY_SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_PASSWORD",
  "APP_SESSION_SECRET",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_PRIVATE_KEY",
  "SEARCH_API_KEY",
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "X_BEARER_TOKEN",
  "WORKER_SHARED_SECRET",
  "SENTRY_DSN",
] as const;

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    VERCEL_ENV: z
      .enum(["development", "preview", "production"])
      .optional()
      .or(emptyToUndefined),
    APP_URL: optionalUrl,

    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,

    SUPABASE_SERVICE_ROLE_KEY: optionalString,

    /** Explicit mock UI/API candidate data. Never silently enabled in production. */
    USE_MOCK_CANDIDATES: booleanFlag,
    ALLOW_MOCK_CANDIDATES_IN_PREVIEW: booleanFlag,
    /**
     * Deterministic demo fixtures. Explicit opt-in only.
     * Allowed on a dedicated demo server (including NODE_ENV=production) when set
     * intentionally; never inferred from missing config.
     */
    DEMO_MODE: booleanFlag,

    GOOGLE_SHEET_ID: optionalString,
    GOOGLE_SHEET_TAB: optionalString,
    GOOGLE_SERVICE_ACCOUNT_JSON: optionalString,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalString,
    GOOGLE_PRIVATE_KEY: optionalString,
    GOOGLE_SPREADSHEET_ID: optionalString,
    GOOGLE_SHEET_NAME: optionalString,
    NEXT_PUBLIC_GOOGLE_SHEET_URL: optionalUrl,

    SEARCH_PROVIDER: searchProviderSchema,
    SEARCH_API_KEY: optionalString,

    X_MCP_MODE: z
      .enum(["app-only"])
      .optional()
      .or(emptyToUndefined),
    X_BEARER_TOKEN: optionalString,
    X_MCP_URL: optionalUrl,
    X_MAX_QUERIES_PER_RUN: positiveIntString,
    X_MAX_POSTS_PER_QUERY: positiveIntString,
    X_TOTAL_POST_LIMIT: positiveIntString,
    X_REQUEST_TIMEOUT_MS: positiveIntString,

    LLM_PROVIDER: llmProviderSchema,
    LLM_API_KEY: optionalString,
    LLM_MODEL: optionalString,
    LLM_REQUEST_TIMEOUT_MS: positiveIntString,
    LLM_MAX_RETRIES: positiveIntString,
    LLM_MAX_OUTPUT_TOKENS: positiveIntString,
    LLM_MAX_CALLS_PER_RUN: positiveIntString,
    LLM_MAX_CALLS_PER_CANDIDATE: positiveIntString,

    APP_PASSWORD: optionalString,
    APP_SESSION_SECRET: optionalString,

    SENTRY_DSN: optionalUrl,
    NEXT_PUBLIC_SENTRY_DSN: optionalUrl,

    DISCOVERY_EXECUTION_MODE: z
      .enum(["local", "worker"])
      .optional()
      .or(emptyToUndefined),
    WORKER_SHARED_SECRET: optionalString,
    DISCOVERY_MAX_ACTIVE_JOBS: positiveIntString,
    DISCOVERY_MAX_QUEUED_JOBS: positiveIntString,
    DISCOVERY_PUBLIC_SOURCE_CONCURRENCY: positiveIntString,
    DISCOVERY_SOURCE_LOCK_WAIT_MS: positiveIntString,
    DISCOVERY_JOB_TIMEOUT_MS: positiveIntString,
    DISCOVERY_EVENT_RETENTION_DAYS: positiveIntString,

    BROWSER_PROFILE_ROOT: optionalString,
    HAKKU_PROFILE_NAME: optionalString,
    HAKKU_BROWSER_HEADLESS: booleanFlag,

    PERSISTENCE_ROLLBACK_V1: booleanFlag,
    PERSISTENCE_BATCH_VERIFY_AFTER_WRITE: booleanFlag,
    PERSISTENCE_BATCH_SHADOW: booleanFlag,
  })
  .superRefine((env, ctx) => {
    const previewMockAllowed =
      env.VERCEL_ENV === "preview" && env.ALLOW_MOCK_CANDIDATES_IN_PREVIEW;
    if (
      env.NODE_ENV === "production" &&
      env.USE_MOCK_CANDIDATES &&
      !previewMockAllowed &&
      !env.DEMO_MODE
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["USE_MOCK_CANDIDATES"],
        message:
          "USE_MOCK_CANDIDATES=true is not allowed in production unless DEMO_MODE=true (dedicated demo) or ALLOW_MOCK_CANDIDATES_IN_PREVIEW=true on preview deployments.",
      });
    }

    if (
      env.NODE_ENV === "production" &&
      env.PERSISTENCE_ROLLBACK_V1 &&
      !env.DEMO_MODE
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PERSISTENCE_ROLLBACK_V1"],
        message:
          "PERSISTENCE_ROLLBACK_V1 is an emergency-only flag and must not be enabled in production.",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

export function resetServerEnvCacheForTests(): void {
  cachedEnv = null;
}

export function getServerEnv(): ServerEnv {
  if (!cachedEnv) {
    cachedEnv = serverEnvSchema.parse(process.env);
  }
  return cachedEnv;
}

export function isDemoMode(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.DEMO_MODE);
}

export function isFixtureCandidatesMode(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.DEMO_MODE || env.USE_MOCK_CANDIDATES);
}

export function hasSupabaseConfig(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function hasGoogleSheetsConfig(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.GOOGLE_SHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export function getGoogleSheetTab(env: ServerEnv = getServerEnv()): string {
  return env.GOOGLE_SHEET_TAB?.trim() || "Hackathons";
}

export function hasSearchConfig(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.SEARCH_PROVIDER && env.SEARCH_API_KEY);
}

export function hasXConfig(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.X_BEARER_TOKEN?.trim());
}

export function hasLlmConfig(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.LLM_PROVIDER === "mock" || (env.LLM_PROVIDER && env.LLM_API_KEY));
}

export function hasOwnerAuthConfig(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.APP_PASSWORD && env.APP_SESSION_SECRET);
}

export function validateProductionConfig(env: ServerEnv = getServerEnv()): string[] {
  const issues: string[] = [];
  const isProductionTarget =
    env.NODE_ENV === "production" || env.VERCEL_ENV === "production";

  if (!isProductionTarget) return issues;

  if (env.DEMO_MODE) {
    if (!hasOwnerAuthConfig(env)) {
      issues.push(
        "Demo mode still requires owner auth: set APP_PASSWORD and APP_SESSION_SECRET.",
      );
    }
    if ((env.APP_SESSION_SECRET?.length ?? 0) < 32) {
      issues.push("APP_SESSION_SECRET must be at least 32 characters.");
    }
    if (env.PERSISTENCE_ROLLBACK_V1) {
      issues.push("PERSISTENCE_ROLLBACK_V1 must remain disabled in demo mode.");
    }
    return issues;
  }

  if (!hasSupabaseConfig(env)) {
    issues.push(
      "Supabase production config is incomplete: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  if (!hasOwnerAuthConfig(env)) {
    issues.push(
      "Owner auth is incomplete: set APP_PASSWORD and APP_SESSION_SECRET.",
    );
  }
  if ((env.APP_SESSION_SECRET?.length ?? 0) < 32) {
    issues.push("APP_SESSION_SECRET must be at least 32 characters.");
  }
  if (env.USE_MOCK_CANDIDATES) {
    issues.push("USE_MOCK_CANDIDATES must be false for production.");
  }
  if (env.PERSISTENCE_ROLLBACK_V1) {
    issues.push("PERSISTENCE_ROLLBACK_V1 must be false for production.");
  }
  if (!hasGoogleSheetsConfig(env)) {
    issues.push(
      "Google Sheets production config is incomplete: set GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON.",
    );
  }

  return issues;
}

export type EnvCheckIntegration = {
  name: string;
  status: "enabled" | "disabled" | "partial";
  detail: string;
};

export function describeIntegrations(env: ServerEnv = getServerEnv()): EnvCheckIntegration[] {
  return [
    {
      name: "owner_auth",
      status: hasOwnerAuthConfig(env) ? "enabled" : "disabled",
      detail: hasOwnerAuthConfig(env)
        ? "APP_PASSWORD + APP_SESSION_SECRET set"
        : "missing APP_PASSWORD and/or APP_SESSION_SECRET",
    },
    {
      name: "supabase",
      status: hasSupabaseConfig(env) ? "enabled" : "disabled",
      detail: hasSupabaseConfig(env)
        ? "URL, anon key, and service-role key set"
        : "incomplete (required for full mode writes)",
    },
    {
      name: "google_sheets",
      status: hasGoogleSheetsConfig(env) ? "enabled" : "disabled",
      detail: hasGoogleSheetsConfig(env)
        ? "sheet id + service account JSON set"
        : "optional; approve sync disabled until configured",
    },
    {
      name: "search",
      status: hasSearchConfig(env)
        ? "enabled"
        : env.SEARCH_PROVIDER === "mock"
          ? "enabled"
          : "disabled",
      detail: hasSearchConfig(env)
        ? `provider=${env.SEARCH_PROVIDER}`
        : env.SEARCH_PROVIDER === "mock"
          ? "provider=mock (no API key)"
          : "optional; web collector degrades",
    },
    {
      name: "llm",
      status: hasLlmConfig(env) ? "enabled" : "disabled",
      detail: hasLlmConfig(env)
        ? `provider=${env.LLM_PROVIDER}`
        : "optional; deterministic parsing used when unset",
    },
    {
      name: "x_mcp",
      status: hasXConfig(env) ? "enabled" : "disabled",
      detail: hasXConfig(env)
        ? "optional X bearer configured"
        : "optional; not required",
    },
    {
      name: "demo_mode",
      status: env.DEMO_MODE ? "enabled" : "disabled",
      detail: env.DEMO_MODE
        ? "fixture candidates; no Supabase/Sheets writes from demo store"
        : "off",
    },
    {
      name: "mock_candidates",
      status: env.USE_MOCK_CANDIDATES ? "enabled" : "disabled",
      detail: env.USE_MOCK_CANDIDATES
        ? "development fixture store"
        : "off",
    },
  ];
}

export function isServerOnlyEnvName(name: string): boolean {
  return (SERVER_ONLY_SECRET_NAMES as readonly string[]).includes(name);
}

export function assertNoSecretInClientBundleSample(
  sample: string,
  secretNames: readonly string[] = SERVER_ONLY_SECRET_NAMES,
): string[] {
  const hits: string[] = [];
  for (const name of secretNames) {
    // Flag only suspicious assignments of secret env names in client-looking bundles.
    const pattern = new RegExp(
      String.raw`(?:process\.env\.${name}|${name}\s*[:=]\s*["'][^"']{8,})`,
    );
    if (pattern.test(sample)) {
      hits.push(name);
    }
  }
  return hits;
}
