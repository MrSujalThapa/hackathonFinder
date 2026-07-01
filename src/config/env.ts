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
  .enum(["openai", "anthropic", "mock"])
  .optional()
  .or(emptyToUndefined);

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,

  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  GOOGLE_SHEET_ID: optionalString,
  GOOGLE_SERVICE_ACCOUNT_JSON: optionalString,

  SEARCH_PROVIDER: searchProviderSchema,
  SEARCH_API_KEY: optionalString,

  X_BEARER_TOKEN: optionalString,
  X_MCP_URL: optionalUrl,

  LLM_PROVIDER: llmProviderSchema,
  LLM_API_KEY: optionalString,
  LLM_MODEL: optionalString,
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

export function hasSearchConfig(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.SEARCH_PROVIDER && env.SEARCH_API_KEY);
}

export function hasXConfig(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.X_BEARER_TOKEN || env.X_MCP_URL);
}

export function hasLlmConfig(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.LLM_PROVIDER && env.LLM_API_KEY);
}
