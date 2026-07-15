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

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    VERCEL_ENV: z
      .enum(["development", "preview", "production"])
      .optional()
      .or(emptyToUndefined),

    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,

    SUPABASE_SERVICE_ROLE_KEY: optionalString,

    /** Explicit mock UI/API candidate data. Never silently enabled in production. */
    USE_MOCK_CANDIDATES: booleanFlag,
    ALLOW_MOCK_CANDIDATES_IN_PREVIEW: booleanFlag,

    GOOGLE_SHEET_ID: optionalString,
    GOOGLE_SHEET_TAB: optionalString,
    GOOGLE_SERVICE_ACCOUNT_JSON: optionalString,
    NEXT_PUBLIC_GOOGLE_SHEET_URL: optionalUrl,

    SEARCH_PROVIDER: searchProviderSchema,
    SEARCH_API_KEY: optionalString,

    X_MCP_MODE: z
      .enum(["app-only"])
      .optional()
      .or(emptyToUndefined),
    X_BEARER_TOKEN: optionalString,
    X_MCP_URL: optionalUrl,
    X_MAX_QUERIES_PER_RUN: optionalString,
    X_MAX_POSTS_PER_QUERY: optionalString,
    X_TOTAL_POST_LIMIT: optionalString,
    X_REQUEST_TIMEOUT_MS: optionalString,

    LLM_PROVIDER: llmProviderSchema,
    LLM_API_KEY: optionalString,
    LLM_MODEL: optionalString,
    LLM_REQUEST_TIMEOUT_MS: optionalString,
    LLM_MAX_RETRIES: optionalString,
    LLM_MAX_OUTPUT_TOKENS: optionalString,
    LLM_MAX_CALLS_PER_RUN: optionalString,
    LLM_MAX_CALLS_PER_CANDIDATE: optionalString,

    APP_PASSWORD: optionalString,
    APP_SESSION_SECRET: optionalString,

    SENTRY_DSN: optionalUrl,
    NEXT_PUBLIC_SENTRY_DSN: optionalUrl,
  })
  .superRefine((env, ctx) => {
    const previewMockAllowed =
      env.VERCEL_ENV === "preview" && env.ALLOW_MOCK_CANDIDATES_IN_PREVIEW;
    if (
      env.NODE_ENV === "production" &&
      env.USE_MOCK_CANDIDATES &&
      !previewMockAllowed
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["USE_MOCK_CANDIDATES"],
        message:
          "USE_MOCK_CANDIDATES=true is not allowed in production. Use Supabase, or set ALLOW_MOCK_CANDIDATES_IN_PREVIEW=true only on preview deployments.",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (!cachedEnv) {
    cachedEnv = serverEnvSchema.parse(process.env);
  }
  return cachedEnv;
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
  if (!hasGoogleSheetsConfig(env)) {
    issues.push(
      "Google Sheets production config is incomplete: set GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON.",
    );
  }

  return issues;
}
