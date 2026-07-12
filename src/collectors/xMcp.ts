import { planXQueries } from "@/agent/planXQueries";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import type { RawLead } from "@/core/discovery/types";
import { selectPublicPostSearchTools, xReadOnlyToolPolicy } from "@/lib/mcp/allowlist";
import { createMcpClient, type McpClient } from "@/lib/mcp/client";
import { McpError } from "@/lib/mcp/errors";
import { createHttpMcpTransport } from "@/lib/mcp/httpTransport";
import type { McpCallToolResult, McpTool } from "@/lib/mcp/types";
import { normalizeUrl, uniqueUrls } from "@/lib/http/url";
import {
  getXBearerToken,
  getXMcpConfig,
  isXConfigured,
  type XMcpConfig,
} from "@/lib/x/config";

const EVENT_NAME =
  /\b(hackathon|buildathon|codefest|hack\s*day)\b/i;

const APPLY_SIGNAL =
  /\b(apply|applications?|registration|deadline|join|building|weekend|prize)\b/i;

const COMMENTARY_REJECT =
  /\b(what is a hackathon|tips for|wikipedia|how to win|i attended last year|throwback|recap of (19|20)\d{2}|history of hackathons)\b/i;

const OPEN_REG_SIGNAL =
  /\b(applications?\s+open|registration\s+open|apply\s+now|still\s+open|deadline|register\s+now)\b/i;

const SOCIAL_HOST =
  /^(?:www\.)?(?:x\.com|twitter\.com|t\.co|mobile\.twitter\.com)$/i;

const EVENT_HOST =
  /(?:^|\.)(mlh\.io|mlh\.com|devpost\.com|lu\.ma|luma\.com|eventbrite\.com|unstop\.com)$/i;

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/gi;

export type ParsedXPost = {
  id: string;
  text: string;
  createdAt?: string;
  username?: string;
  authorId?: string;
  expandedUrls: string[];
  raw?: Record<string, unknown>;
};

export type XMcpCollectorDeps = {
  /**
   * Inject a pre-built MCP client (tests). When set, live env/config is not required.
   */
  createClient?: () =>
    | Promise<{ client: McpClient; close?: () => Promise<void> }>
    | { client: McpClient; close?: () => Promise<void> };
  /** Override configuration probe (defaults to isXConfigured). */
  isConfigured?: () => boolean;
  /** Override X MCP config (defaults to getXMcpConfig). */
  getConfig?: () => XMcpConfig;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function schemaPropertyNames(tool: McpTool): string[] {
  const schema = asRecord(tool.inputSchema);
  const props = asRecord(schema?.properties);
  return props ? Object.keys(props) : [];
}

/**
 * Map planner query + limit onto whatever argument names the search tool expects.
 */
export function buildXSearchToolArgs(
  tool: McpTool,
  query: string,
  maxPosts: number,
): Record<string, unknown> {
  const props = schemaPropertyNames(tool);
  const lower = new Map(props.map((p) => [p.toLowerCase(), p]));

  const queryKey =
    lower.get("query") ??
    lower.get("q") ??
    lower.get("search") ??
    lower.get("search_query") ??
    lower.get("text") ??
    (props.length === 0 ? "query" : undefined) ??
    "query";

  const limitKey =
    lower.get("max_results") ??
    lower.get("limit") ??
    lower.get("count") ??
    lower.get("maxresults") ??
    lower.get("max_results_per_page") ??
    (props.length === 0 ? "max_results" : undefined);

  const args: Record<string, unknown> = {
    [queryKey]: query,
  };
  if (limitKey) {
    args[limitKey] = maxPosts;
  } else {
    // Common alternates when schema is unknown / incomplete
    args.max_results = maxPosts;
    args.limit = maxPosts;
  }

  // Prefer recent posts + useful expansions when the discovered schema allows them.
  if (lower.has("sort_order")) args[lower.get("sort_order")!] = "recency";
  if (lower.has("expansions")) {
    args[lower.get("expansions")!] = "author_id,entities.mentions.username";
  }
  const postFieldsKey =
    lower.get("post.fields") ?? lower.get("tweet.fields") ?? lower.get("post_fields");
  if (postFieldsKey) {
    args[postFieldsKey] = "created_at,entities,author_id,note_tweet";
  }
  const userFieldsKey = lower.get("user.fields") ?? lower.get("user_fields");
  if (userFieldsKey) {
    args[userFieldsKey] = "username,name";
  }

  return args;
}

/** Extract a short human message from MCP tool isError content. */
export function describeToolCallError(result: McpCallToolResult): string {
  const texts = result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean);
  const joined = texts.join(" ");
  if (!joined) return "tool returned isError with empty content";

  const parsed = tryParseJson(joined);
  const obj = asRecord(parsed);
  if (obj) {
    const status = typeof obj.status === "number" ? obj.status : undefined;
    const detail =
      (typeof obj.detail === "string" && obj.detail) ||
      (typeof obj.title === "string" && obj.title) ||
      undefined;
    if (status === 402 || /credits?\s*deplet/i.test(joined)) {
      return `credits/quota exhausted${detail ? ` (${detail})` : ""}`;
    }
    if (status === 429 || /too many requests|rate.?limit/i.test(joined)) {
      return `rate limited${detail ? ` (${detail})` : ""}`;
    }
    if (status === 401 || status === 403) {
      return `auth failed${detail ? ` (${detail})` : ""}`;
    }
    if (detail) return detail;
  }

  if (/credits?\s*deplet/i.test(joined)) return "credits/quota exhausted";
  if (/too many requests|rate.?limit/i.test(joined)) return "rate limited";
  return joined.slice(0, 240);
}

export function isToolCallQuotaFailure(result: McpCallToolResult): boolean {
  const message = describeToolCallError(result).toLowerCase();
  return (
    message.includes("credits") ||
    message.includes("quota") ||
    message.includes("rate limited") ||
    message.includes("402") ||
    message.includes("429")
  );
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some servers wrap JSON in prose — pull the outermost object/array.
    const startObj = trimmed.indexOf("{");
    const startArr = trimmed.indexOf("[");
    let start = -1;
    if (startObj >= 0 && startArr >= 0) start = Math.min(startObj, startArr);
    else start = Math.max(startObj, startArr);
    if (start < 0) return undefined;
    const candidate = trimmed.slice(start);
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
}

function usernameFromAuthor(author: unknown): string | undefined {
  const obj = asRecord(author);
  if (!obj) return undefined;
  if (typeof obj.username === "string" && obj.username.trim()) {
    return obj.username.replace(/^@/, "").trim();
  }
  if (typeof obj.screen_name === "string" && obj.screen_name.trim()) {
    return obj.screen_name.replace(/^@/, "").trim();
  }
  if (typeof obj.handle === "string" && obj.handle.trim()) {
    return obj.handle.replace(/^@/, "").trim();
  }
  return undefined;
}

function collectUrlEntities(entities: unknown): string[] {
  const obj = asRecord(entities);
  if (!obj) return [];
  const urls = obj.urls;
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  for (const item of urls) {
    const row = asRecord(item);
    if (!row) continue;
    if (typeof row.expanded_url === "string") out.push(row.expanded_url);
    if (typeof row.url === "string") out.push(row.url);
    if (typeof row.unwound_url === "string") out.push(row.unwound_url);
  }
  return out;
}

function urlsFromText(text: string): string[] {
  const matches = text.match(URL_IN_TEXT) ?? [];
  return matches.map((u) => u.replace(/[.,;:!?)]+$/, ""));
}

function buildUserIndex(payload: Record<string, unknown>): Map<string, string> {
  const index = new Map<string, string>();
  const includes = asRecord(payload.includes);
  const users = includes?.users;
  if (!Array.isArray(users)) return index;
  for (const user of users) {
    const row = asRecord(user);
    if (!row) continue;
    const id = typeof row.id === "string" ? row.id : undefined;
    const username = usernameFromAuthor(row);
    if (id && username) index.set(id, username);
  }
  return index;
}

function normalizePostObject(
  raw: Record<string, unknown>,
  userIndex: Map<string, string>,
): ParsedXPost | undefined {
  const idRaw = raw.id ?? raw.post_id ?? raw.tweet_id ?? raw.status_id;
  const id = idRaw != null ? String(idRaw).trim() : "";
  if (!id) return undefined;

  const text =
    (typeof raw.text === "string" && raw.text) ||
    (typeof raw.full_text === "string" && raw.full_text) ||
    (typeof raw.body === "string" && raw.body) ||
    "";

  const createdAt =
    (typeof raw.created_at === "string" && raw.created_at) ||
    (typeof raw.createdAt === "string" && raw.createdAt) ||
    (typeof raw.posted_at === "string" && raw.posted_at) ||
    undefined;

  const authorId =
    typeof raw.author_id === "string"
      ? raw.author_id
      : typeof raw.authorId === "string"
        ? raw.authorId
        : undefined;

  let username =
    usernameFromAuthor(raw.author) ??
    usernameFromAuthor(raw.user) ??
    (typeof raw.username === "string" ? raw.username.replace(/^@/, "") : undefined) ??
    (authorId ? userIndex.get(authorId) : undefined);

  if (typeof username === "string") {
    username = username.replace(/^@/, "").trim() || undefined;
  }

  const expandedUrls = uniqueUrls([
    ...collectUrlEntities(raw.entities),
    ...collectUrlEntities(asRecord(raw.entities)?.url),
    ...urlsFromText(text),
  ]);

  return {
    id,
    text,
    createdAt,
    username,
    authorId,
    expandedUrls,
    raw,
  };
}

function extractPostArrays(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = asRecord(payload);
  if (!obj) return [];

  for (const key of ["data", "posts", "tweets", "results", "statuses"]) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }

  // Nested { result: { data: [...] } } / { search: { posts: [...] } }
  for (const nestedKey of ["result", "search", "payload", "response"]) {
    const nested = obj[nestedKey];
    const fromNested = extractPostArrays(nested);
    if (fromNested.length > 0) return fromNested;
  }

  // Single post object
  if (obj.id != null && (obj.text != null || obj.full_text != null)) {
    return [obj];
  }

  return [];
}

/** Parse posts from an MCP tools/call result (structuredContent and/or JSON text blocks). */
export function parseXPostsFromCallResult(
  result: McpCallToolResult,
): ParsedXPost[] {
  const chunks: unknown[] = [];
  if (result.structuredContent !== undefined) {
    chunks.push(result.structuredContent);
  }
  for (const block of result.content) {
    if (block.type === "text") {
      const parsed = tryParseJson(block.text);
      if (parsed !== undefined) chunks.push(parsed);
    } else if (block.type === "resource" && block.resource.text) {
      const parsed = tryParseJson(block.resource.text);
      if (parsed !== undefined) chunks.push(parsed);
    }
  }

  const posts: ParsedXPost[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const root = asRecord(chunk) ?? {};
    const userIndex = buildUserIndex(root);
    // Also index users from sibling includes when chunk is bare array wrapped later
    if (Array.isArray(chunk)) {
      // no includes
    }
    for (const item of extractPostArrays(chunk)) {
      const row = asRecord(item);
      if (!row) continue;
      const post = normalizePostObject(row, userIndex);
      if (!post || seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
  }

  return posts;
}

export function canonicalizeXPostUrl(
  postId: string,
  username?: string,
): string {
  const handle = username?.replace(/^@/, "").trim();
  if (handle) return `https://x.com/${handle}/status/${postId}`;
  return `https://x.com/i/status/${postId}`;
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export function isSocialUrl(url: string): boolean {
  const host = hostnameOf(url);
  return Boolean(host && SOCIAL_HOST.test(host));
}

export function looksLikeEventOutboundUrl(url: string): boolean {
  const normalized = normalizeUrl(url);
  if (!normalized || isSocialUrl(normalized)) return false;
  const host = hostnameOf(normalized);
  if (host && EVENT_HOST.test(host)) return true;
  if (host && /\b(hack|devpost|mlh|luma|eventbrite|unstop)\b/i.test(host.replace(/\./g, " "))) {
    return true;
  }
  // Non-social outbound with event-ish path
  return /\/(event|hack|apply|register|challenge)/i.test(normalized);
}

function postedYear(iso?: string): number | undefined {
  if (!iso) return undefined;
  const y = Number.parseInt(iso.slice(0, 4), 10);
  return Number.isFinite(y) ? y : undefined;
}

function textMentionsOldYear(text: string, currentYear: number): boolean {
  const years = [...text.matchAll(/\b(19|20)\d{2}\b/g)].map((m) =>
    Number.parseInt(m[0], 10),
  );
  return years.some((y) => y <= currentYear - 2);
}

/**
 * Conservative announcement filter: keep apply/registration signals or outbound event links;
 * drop tips, definitions, throwbacks, and clearly historical posts.
 */
export function isPromisingXPost(
  post: ParsedXPost,
  now = new Date(),
): boolean {
  const text = post.text ?? "";
  if (!text.trim()) return false;

  if (COMMENTARY_REJECT.test(text)) return false;

  const hasEvent = EVENT_NAME.test(text);
  const hasApply = APPLY_SIGNAL.test(text);
  const hasOpen = OPEN_REG_SIGNAL.test(text);
  const hasOutboundEvent = post.expandedUrls.some((u) =>
    looksLikeEventOutboundUrl(u),
  );

  if (!hasEvent && !hasOutboundEvent) return false;

  const currentYear = now.getUTCFullYear();
  const createdYear = postedYear(post.createdAt);
  const looksHistorical =
    textMentionsOldYear(text, currentYear) ||
    (createdYear !== undefined && createdYear <= currentYear - 2);

  if (looksHistorical && !hasOpen) return false;

  if (hasEvent && (hasApply || hasOpen)) return true;
  if (hasOutboundEvent && (hasEvent || hasApply || hasOpen)) return true;

  return false;
}

export function expandPostUrls(post: ParsedXPost, socialUrl: string): string[] {
  return uniqueUrls([...post.expandedUrls, socialUrl]);
}

function pickOfficialUrl(urls: string[]): string | undefined {
  for (const url of urls) {
    if (looksLikeEventOutboundUrl(url)) return normalizeUrl(url);
  }
  return undefined;
}

export function xPostToLead(post: ParsedXPost, query: string): RawLead | undefined {
  if (!isPromisingXPost(post)) return undefined;

  const socialUrl = canonicalizeXPostUrl(post.id, post.username);
  const links = expandPostUrls(post, socialUrl);
  const officialUrl = pickOfficialUrl(links);
  const postedAt =
    post.createdAt && !Number.isNaN(Date.parse(post.createdAt))
      ? new Date(post.createdAt).toISOString()
      : new Date().toISOString();

  const title =
    post.text.replace(/\s+/g, " ").trim().slice(0, 120) ||
    `X post ${post.id}`;

  return {
    id: `x-${post.id}`,
    source: "x",
    title,
    url: socialUrl,
    text: post.text,
    links,
    postedAt,
    metadata: {
      socialUrl,
      username: post.username,
      postId: post.id,
      query,
      evidenceType: "x_post",
      sourceIds: { x: post.id },
      ...(officialUrl ? { officialUrl } : {}),
    },
  };
}

function recordMcpFailure(
  result: CollectorResult,
  error: unknown,
  context: string,
): void {
  if (error instanceof McpError) {
    const msg = `X MCP ${context}: [${error.category}] ${error.message}`;
    if (
      error.category === "auth" ||
      error.category === "policy" ||
      error.category === "missing_tool"
    ) {
      result.errors.push(msg);
    } else {
      result.warnings.push(msg);
    }
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  result.warnings.push(`X MCP ${context}: ${message}`);
}

async function defaultCreateClient(
  config: XMcpConfig,
  timeoutMs: number,
): Promise<{ client: McpClient; close?: () => Promise<void> }> {
  const token = getXBearerToken();
  if (!token) {
    throw new McpError(
      "auth",
      "X MCP is not configured (missing X_BEARER_TOKEN)",
    );
  }
  const transport = createHttpMcpTransport({
    url: config.url,
    bearerToken: token,
    timeoutMs: Math.min(timeoutMs, config.requestTimeoutMs),
  });
  const client = createMcpClient({
    transport,
    toolPolicy: xReadOnlyToolPolicy,
  });
  return { client };
}

/**
 * X MCP collector — public-post search only (read-only allowlist enforced).
 * Posts become RawLead evidence; they are not verified events.
 */
export function createXMcpCollector(deps: XMcpCollectorDeps = {}): Collector {
  return {
    source: "x",

    async collect(input: CollectorInput): Promise<CollectorResult> {
      const startedAt = Date.now();
      const result = emptyCollectorResult("x", startedAt);

      const configured = deps.isConfigured
        ? deps.isConfigured()
        : Boolean(deps.createClient) || isXConfigured();

      if (!configured) {
        result.warnings.push(
          "X MCP not configured (set X_BEARER_TOKEN and X_MCP_URL); skipping x discovery.",
        );
        result.durationMs = Date.now() - startedAt;
        return result;
      }

      const config = deps.getConfig?.() ?? getXMcpConfig();
      let close: (() => Promise<void>) | undefined;

      try {
        const created = await (deps.createClient
          ? deps.createClient()
          : defaultCreateClient(config, input.timeoutMs));
        const client = created.client;
        close = created.close;

        await client.initialize();
        const tools = await client.listTools();
        const searchTools = selectPublicPostSearchTools(tools);

        if (searchTools.length === 0) {
          result.warnings.push(
            "X MCP listed no public post search tools; skipping x discovery.",
          );
          result.durationMs = Date.now() - startedAt;
          return result;
        }

        const searchTool = searchTools[0]!;
        const queries = planXQueries(input.preferences, {
          maxQueries: config.maxQueriesPerRun,
        });
        const maxPosts = Math.max(1, config.maxPostsPerQuery);
        const totalLimit = Math.min(
          input.maxResults,
          Math.max(1, config.totalPostLimit),
        );

        const seenIds = new Set<string>();
        const leads: RawLead[] = [];
        let queriesExecuted = 0;
        let postsReturned = 0;
        let postsRejectedNoise = 0;
        let rateQuotaWarnings = 0;

        for (const query of queries) {
          if (leads.length >= totalLimit) break;

          const args = buildXSearchToolArgs(searchTool, query, maxPosts);
          try {
            queriesExecuted += 1;
            const callResult = await client.callTool(searchTool.name, args);
            if (callResult.isError) {
              const detail = describeToolCallError(callResult);
              result.warnings.push(
                `X MCP search failed for query "${query}": ${detail}`,
              );
              if (isToolCallQuotaFailure(callResult)) {
                rateQuotaWarnings += 1;
                // Stop burning remaining queries when credits/rate are exhausted.
                break;
              }
              continue;
            }

            const posts = parseXPostsFromCallResult(callResult).slice(
              0,
              maxPosts,
            );
            postsReturned += posts.length;
            for (const post of posts) {
              if (seenIds.has(post.id)) continue;
              seenIds.add(post.id);

              const lead = xPostToLead(post, query);
              if (!lead) {
                postsRejectedNoise += 1;
                continue;
              }
              leads.push(lead);
              if (leads.length >= totalLimit) break;
            }
          } catch (error) {
            recordMcpFailure(result, error, `search "${query}"`);
            if (error instanceof McpError && error.category === "rate_quota") {
              rateQuotaWarnings += 1;
            }
            // Auth failures: stop further queries
            if (error instanceof McpError && error.category === "auth") {
              break;
            }
          }
        }

        const postsWithLinks = leads.filter((lead) =>
          lead.links.some((link) => {
            try {
              const host = new URL(link).hostname.replace(/^www\./, "");
              return !SOCIAL_HOST.test(host);
            } catch {
              return false;
            }
          }),
        ).length;

        result.leads = leads;
        result.metrics = {
          queriesPlanned: queries.length,
          queriesExecuted,
          postsReturned,
          postsDeduped: seenIds.size,
          postsWithLinks,
          postsKept: leads.length,
          postsRejectedNoise,
          rateQuotaWarnings,
        };
      } catch (error) {
        recordMcpFailure(result, error, "collect");
      } finally {
        if (close) {
          try {
            await close();
          } catch {
            // ignore close errors
          }
        }
      }

      result.durationMs = Date.now() - startedAt;
      return result;
    },
  };
}

export const xMcpCollector = createXMcpCollector();
