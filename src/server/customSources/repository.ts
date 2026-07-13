import type { Database, Json } from "@/lib/supabase/database.types";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import {
  assertSafeCustomSourceUrl,
  normalizeCustomSourceSlug,
} from "@/server/customSources/urlSafety";
import type {
  CreateCustomSourceInput,
  CustomSource,
  CustomSourceHealthUpdate,
  CustomSourceMode,
  CustomSourceSelectors,
  CustomSourceStrategy,
  UpdateCustomSourceInput,
} from "@/server/customSources/types";

type CustomSourceRow = Database["public"]["Tables"]["custom_sources"]["Row"];

function mapRow(row: CustomSourceRow): CustomSource {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    baseUrl: row.base_url,
    listingUrl: row.listing_url,
    mode: row.mode,
    enabled: row.enabled,
    locationScope: row.location_scope,
    topicScope: row.topic_scope,
    maxItems: row.max_items,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    lastErrorSafe: row.last_error_safe,
    selectors: selectorObject(row.selectors),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function selectorObject(value: Json): CustomSourceSelectors {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  return {
    cardSelector: typeof raw.cardSelector === "string" ? raw.cardSelector : undefined,
    titleSelector: typeof raw.titleSelector === "string" ? raw.titleSelector : undefined,
    linkSelector: typeof raw.linkSelector === "string" ? raw.linkSelector : undefined,
    strategy: isCustomSourceStrategy(raw.strategy) ? raw.strategy : undefined,
    titleColumn: typeof raw.titleColumn === "string" ? raw.titleColumn : undefined,
    dateColumn: typeof raw.dateColumn === "string" ? raw.dateColumn : undefined,
    typeColumn: typeof raw.typeColumn === "string" ? raw.typeColumn : undefined,
    urlColumn: typeof raw.urlColumn === "string" ? raw.urlColumn : undefined,
  };
}

function validateMode(mode: CustomSourceMode | undefined): CustomSourceMode {
  if (!mode) return "static";
  if (mode !== "auto" && mode !== "static" && mode !== "playwright" && mode !== "rss" && mode !== "sitemap") {
    throw new Error("Unsupported custom source mode.");
  }
  return mode;
}

function isCustomSourceStrategy(value: unknown): value is CustomSourceStrategy {
  return value === "auto" || value === "cards" || value === "table" || value === "list";
}

function validateColumnName(key: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length > 80) throw new Error(`${key} is too long.`);
  if (/[{}()[\]<>;=]|javascript:|script/i.test(value)) {
    throw new Error(`${key} contains unsupported syntax.`);
  }
  return value.trim();
}

export function validateCustomSourceSelectors(selectors: CustomSourceSelectors): CustomSourceSelectors {
  const out: CustomSourceSelectors = {};
  for (const [key, value] of Object.entries(selectors) as Array<[keyof CustomSourceSelectors, string | undefined]>) {
    if (!value) continue;
    if (key === "strategy") {
      if (!isCustomSourceStrategy(value)) throw new Error("Unsupported custom source strategy.");
      out.strategy = value;
      continue;
    }
    if (key === "titleColumn" || key === "dateColumn" || key === "typeColumn" || key === "urlColumn") {
      out[key] = validateColumnName(key, value);
      continue;
    }
    if (value.length > 300) throw new Error(`${key} is too long.`);
    if (/[{}]|<script|javascript:/i.test(value)) {
      throw new Error(`${key} contains unsupported syntax.`);
    }
    try {
      // Validate CSS syntax in environments with DOM support; otherwise retain string as data.
      if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
        CSS.supports("selector(:scope)");
      }
    } catch {
      throw new Error(`${key} is not a valid CSS selector.`);
    }
    out[key] = value;
  }
  return out;
}

async function sourceRowFromInput(input: CreateCustomSourceInput, options: { prevalidatedUrl?: URL } = {}) {
  const finalUrl = options.prevalidatedUrl ?? (await assertSafeCustomSourceUrl(input.listingUrl));
  const base = `${finalUrl.protocol}//${finalUrl.host}`;
  const row: Database["public"]["Tables"]["custom_sources"]["Insert"] = {
    name: input.name.trim(),
    slug: normalizeCustomSourceSlug(input.slug ?? input.name),
    base_url: base,
    listing_url: finalUrl.toString(),
    mode: validateMode(input.mode),
    enabled: input.enabled ?? true,
    location_scope: (input.locationScope ?? "global").trim().toLowerCase(),
    topic_scope: (input.topicScope ?? []).map((topic) => topic.trim().toLowerCase()).filter(Boolean),
    max_items: Math.min(Math.max(input.maxItems ?? 100, 1), 100),
    status: input.enabled === false ? "disabled" : "unknown",
  };
  return row;
}

export async function createCustomSource(
  input: CreateCustomSourceInput,
  options: { prevalidatedUrl?: URL } = {},
): Promise<CustomSource> {
  const supabase = createServiceSupabaseClient();
  const row = await sourceRowFromInput(input, options);
  const { data, error } = await supabase
    .from("custom_sources")
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to save custom source: ${error.message}`);
  return mapRow(data);
}

export async function listCustomSources(options: { enabledOnly?: boolean } = {}): Promise<CustomSource[]> {
  const supabase = createServiceSupabaseClient();
  let query = supabase
    .from("custom_sources")
    .select("*")
    .order("updated_at", { ascending: false });
  if (options.enabledOnly) query = query.eq("enabled", true);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list custom sources: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function getCustomSource(slugOrName: string): Promise<CustomSource | null> {
  const supabase = createServiceSupabaseClient();
  const slug = normalizeCustomSourceSlug(slugOrName);
  const { data, error } = await supabase
    .from("custom_sources")
    .select("*")
    .or(`slug.eq.${slug},name.eq.${slugOrName}`)
    .maybeSingle();
  if (error) throw new Error(`Failed to get custom source: ${error.message}`);
  return data ? mapRow(data) : null;
}

export async function updateCustomSource(
  slugOrName: string,
  input: UpdateCustomSourceInput,
): Promise<CustomSource> {
  const supabase = createServiceSupabaseClient();
  const existing = await getCustomSource(slugOrName);
  if (!existing) throw new Error(`Custom source not found: ${slugOrName}`);
  const patch: Database["public"]["Tables"]["custom_sources"]["Update"] = {};
  if (input.name) patch.name = input.name.trim();
  if (input.mode) patch.mode = validateMode(input.mode);
  if (input.enabled != null) {
    patch.enabled = input.enabled;
    if (!input.enabled) patch.status = "disabled";
  }
  if (input.locationScope) patch.location_scope = input.locationScope.trim().toLowerCase();
  if (input.topicScope) {
    patch.topic_scope = input.topicScope.map((topic) => topic.trim().toLowerCase()).filter(Boolean);
  }
  if (input.maxItems != null) patch.max_items = Math.min(Math.max(input.maxItems, 1), 100);
  if (input.selectors) patch.selectors = validateCustomSourceSelectors(input.selectors) as Json;
  if (input.listingUrl) {
    const finalUrl = await assertSafeCustomSourceUrl(input.listingUrl);
    patch.listing_url = finalUrl.toString();
    patch.base_url = `${finalUrl.protocol}//${finalUrl.host}`;
  }

  const { data, error } = await supabase
    .from("custom_sources")
    .update(patch)
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to update custom source: ${error.message}`);
  return mapRow(data);
}

export async function deleteCustomSource(slugOrName: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const existing = await getCustomSource(slugOrName);
  if (!existing) throw new Error(`Custom source not found: ${slugOrName}`);
  const { error } = await supabase.from("custom_sources").delete().eq("id", existing.id);
  if (error) throw new Error(`Failed to remove custom source: ${error.message}`);
}

export async function setCustomSourceEnabled(slugOrName: string, enabled: boolean): Promise<CustomSource> {
  return updateCustomSource(slugOrName, { enabled });
}

export async function updateCustomSourceHealth(
  slugOrName: string,
  health: CustomSourceHealthUpdate,
): Promise<CustomSource> {
  const supabase = createServiceSupabaseClient();
  const existing = await getCustomSource(slugOrName);
  if (!existing) throw new Error(`Custom source not found: ${slugOrName}`);
  const { data, error } = await supabase
    .from("custom_sources")
    .update({
      status: health.status,
      last_checked_at: health.checkedAt ?? new Date().toISOString(),
      last_error_safe: health.lastErrorSafe ?? null,
    })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to update custom source health: ${error.message}`);
  return mapRow(data);
}

export async function validateCustomSourceUrlForSave(url: string): Promise<URL> {
  return assertSafeCustomSourceUrl(url);
}
