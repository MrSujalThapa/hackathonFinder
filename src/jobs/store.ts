import { getServerEnv, hasSupabaseConfig } from "@/config/env";
import { createMemoryDiscoveryJobStore } from "@/jobs/memoryStore";
import { createSupabaseDiscoveryJobStore } from "@/jobs/supabaseStore";
import type { DiscoveryJobRepository } from "@/jobs/types";

let overrideStore: DiscoveryJobRepository | null = null;
let cachedStore: DiscoveryJobRepository | null = null;

export function setDiscoveryJobStoreForTests(
  store: DiscoveryJobRepository | null,
): void {
  overrideStore = store;
  cachedStore = null;
}

/**
 * Resolve the discovery job repository.
 *
 * - DEV-ONLY in-memory store when explicitly requested or when running locally
 *   without Supabase (clearly labeled).
 * - Supabase store when configured.
 * - Production fails clearly when DB persistence is required but unavailable.
 */
export function getDiscoveryJobStore(): DiscoveryJobRepository {
  if (overrideStore) return overrideStore;
  if (cachedStore) return cachedStore;

  const env = getServerEnv();
  const forceMemory = process.env.DISCOVERY_JOB_STORE === "memory";
  const forceDb = process.env.DISCOVERY_JOB_STORE === "supabase";
  const isProd =
    env.NODE_ENV === "production" || env.VERCEL_ENV === "production";

  if (forceMemory) {
    if (isProd && process.env.DISCOVERY_ALLOW_MEMORY_STORE !== "true") {
      throw new Error(
        "DISCOVERY_JOB_STORE=memory is not allowed in production. Apply migration 006 and use Supabase, or set DISCOVERY_ALLOW_MEMORY_STORE=true only for explicit emergency local use.",
      );
    }
    cachedStore = createMemoryDiscoveryJobStore();
    return cachedStore;
  }

  if (forceDb || hasSupabaseConfig(env)) {
    if (!hasSupabaseConfig(env)) {
      throw new Error(
        "Discovery job persistence requires Supabase. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.",
      );
    }
    cachedStore = createSupabaseDiscoveryJobStore();
    return cachedStore;
  }

  if (isProd) {
    throw new Error(
      "Discovery job persistence is required in production but Supabase is not configured. Set Supabase env vars and apply supabase/migrations/006_discovery_jobs.sql.",
    );
  }

  // Development fallback — clearly labeled inside memory store constructor.
  cachedStore = createMemoryDiscoveryJobStore();
  return cachedStore;
}
