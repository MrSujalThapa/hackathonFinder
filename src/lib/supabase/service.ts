import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getServiceSupabaseConfig } from "./config";

export function createServiceSupabaseClient() {
  const { url, serviceRoleKey } = getServiceSupabaseConfig();

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
