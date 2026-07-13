import { getServerEnv, hasSupabaseConfig } from "@/config/env";
import { createMemoryTerminalSessionStore } from "@/server/terminal/memoryStore";
import { createSupabaseTerminalSessionStore } from "@/server/terminal/supabaseStore";
import type { TerminalSessionRepository } from "@/server/terminal/types";

let overrideStore: TerminalSessionRepository | null = null;
let cachedStore: TerminalSessionRepository | null = null;

export function setTerminalSessionStoreForTests(
  store: TerminalSessionRepository | null,
): void {
  overrideStore = store;
  cachedStore = null;
}

/**
 * Resolve the terminal session repository.
 *
 * - DEV-ONLY in-memory store when explicitly requested or when running locally
 *   without Supabase (clearly labeled).
 * - Supabase store when configured.
 * - Production fails clearly when durable persistence is required but unavailable.
 */
export function getTerminalSessionStore(): TerminalSessionRepository {
  if (overrideStore) return overrideStore;
  if (cachedStore) return cachedStore;

  const env = getServerEnv();
  const forceMemory = process.env.TERMINAL_SESSION_STORE === "memory";
  const forceDb = process.env.TERMINAL_SESSION_STORE === "supabase";
  const isProd =
    env.NODE_ENV === "production" || env.VERCEL_ENV === "production";

  if (forceMemory) {
    if (isProd && process.env.TERMINAL_ALLOW_MEMORY_STORE !== "true") {
      throw new Error(
        "TERMINAL_SESSION_STORE=memory is not allowed in production. Apply migration 007 and use Supabase, or set TERMINAL_ALLOW_MEMORY_STORE=true only for explicit emergency local use.",
      );
    }
    cachedStore = createMemoryTerminalSessionStore();
    return cachedStore;
  }

  if (forceDb || hasSupabaseConfig(env)) {
    if (!hasSupabaseConfig(env)) {
      throw new Error(
        "Terminal session persistence requires Supabase. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.",
      );
    }
    cachedStore = createSupabaseTerminalSessionStore();
    return cachedStore;
  }

  if (isProd) {
    throw new Error(
      "Terminal session persistence is required in production but Supabase is not configured. Set Supabase env vars and apply supabase/migrations/007_terminal_sessions.sql.",
    );
  }

  // Development fallback — clearly labeled inside memory store constructor.
  cachedStore = createMemoryTerminalSessionStore();
  return cachedStore;
}
