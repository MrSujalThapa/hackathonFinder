import { McpError } from "@/lib/mcp/errors";
import type { McpTool } from "@/lib/mcp/types";

export type ToolPolicyDecision = {
  allowed: boolean;
  reason: string;
};

export type ToolPolicy = (tool: {
  name: string;
  description?: string;
}) => ToolPolicyDecision;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_./:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function haystackOf(tool: { name: string; description?: string }): {
  name: string;
  haystack: string;
} {
  const name = normalize(tool.name);
  const desc = tool.description ? normalize(tool.description) : "";
  return { name, haystack: desc ? `${name} ${desc}` : name };
}

/** Explicit deny — checked before any allow heuristic. */
function matchDeny(name: string, haystack: string): string | null {
  if (/\bbookmark/.test(haystack)) {
    return "bookmark tools are blocked by read-only policy";
  }

  if (
    /\b(dm|dms|direct message|direct messages)\b/.test(haystack) ||
    (/\bsend\b/.test(haystack) &&
      /\b(message|conversation|dm)\b/.test(haystack))
  ) {
    return "DM / conversation send tools are blocked";
  }

  if (/\b(like|unlike|likes|favorite|favourites?|fave)\b/.test(haystack)) {
    return "like/favorite tools are blocked";
  }

  if (/\b(repost|retweet|unrepost|unretweet)\b/.test(haystack)) {
    return "repost/retweet tools are blocked";
  }

  if (/\b(follow|unfollow)\b/.test(haystack)) {
    return "follow/unfollow tools are blocked";
  }

  if (
    /\barticle\b/.test(haystack) &&
    /\b(publish|create|draft|update|delete|write)\b/.test(haystack)
  ) {
    return "article publish/create tools are blocked";
  }

  // Mutation verb as the primary tool action (name prefix).
  if (
    /^(create|delete|update|send|add|remove|publish|like|unlike|follow|unfollow|repost|retweet|favorite|favourite)\b/.test(
      name,
    )
  ) {
    return "mutation verb tool name blocked by read-only policy";
  }

  // `post tweet` / `post status` writes (not get_post / search_posts).
  if (/^post (tweet|tweets|status|statuses|message)\b/.test(name)) {
    return "post/publish tweet tools are blocked";
  }

  // Description-led tweet/status mutations without a read verb in the name.
  if (
    /\b(create|delete|publish|update|send)\b.{0,32}\b(tweet|tweets|status|statuses)\b/.test(
      haystack,
    ) ||
    /\b(tweet|tweets|status|statuses)\b.{0,32}\b(create|delete|publish|update|send)\b/.test(
      haystack,
    )
  ) {
    if (!/\b(search|get|fetch|lookup|retrieve|read)\b/.test(name)) {
      return "tweet/status mutation tools are blocked";
    }
  }

  return null;
}

/** Permit only public post search/read and user lookup for attribution. */
function matchAllow(name: string, haystack: string): string | null {
  if (
    /^search (posts|all|recent|archive|tweets)\b/.test(name) ||
    name === "search all" ||
    name === "search posts"
  ) {
    return "public post search tool";
  }

  if (
    /^(get|fetch|lookup|retrieve) (post|posts|tweet|tweets|status|statuses)\b/.test(
      name,
    )
  ) {
    return "public post read tool";
  }

  if (
    /^(get|fetch|lookup|retrieve) (user|users)\b/.test(name) ||
    /^(user|users) lookup\b/.test(name)
  ) {
    return "public user lookup for attribution";
  }

  const hasSearch = /\bsearch\b/.test(haystack);
  const hasRead = /\b(get|fetch|lookup|retrieve|read)\b/.test(haystack);
  const hasPost = /\b(post|posts|tweet|tweets|status|statuses|archive)\b/.test(
    haystack,
  );
  const hasUser = /\b(user|users)\b/.test(haystack);

  if (hasSearch && hasPost) {
    return "search + post/tweet/status/archive";
  }
  if (hasRead && hasPost) {
    return "get/fetch/lookup/retrieve + post/tweet/status";
  }
  if (hasRead && hasUser) {
    return "get/lookup/fetch + user (attribution)";
  }

  return null;
}

/**
 * Deny-by-default X MCP tool policy (code-enforced, not model instructions).
 */
export function evaluateXToolPolicy(tool: {
  name: string;
  description?: string;
}): ToolPolicyDecision {
  const trimmed = tool.name?.trim() ?? "";
  if (!trimmed) {
    return { allowed: false, reason: "empty tool name denied by default" };
  }

  const { name, haystack } = haystackOf(tool);

  const denyReason = matchDeny(name, haystack);
  if (denyReason) {
    return { allowed: false, reason: denyReason };
  }

  const allowReason = matchAllow(name, haystack);
  if (allowReason) {
    return { allowed: true, reason: allowReason };
  }

  return {
    allowed: false,
    reason: "unknown tool denied by default (read-only allowlist)",
  };
}

/** Default policy function suitable for McpClient `toolPolicy`. */
export const xReadOnlyToolPolicy: ToolPolicy = evaluateXToolPolicy;

/**
 * Throws McpError(category: "policy") when the tool is blocked.
 * When `tools` is provided and the name is absent, throws missing_tool.
 */
export function assertXToolAllowed(
  toolName: string,
  tools?: McpTool[],
): void {
  let description: string | undefined;
  if (tools) {
    const found = tools.find((t) => t.name === toolName);
    if (!found) {
      throw new McpError("missing_tool", `Unknown tool: ${toolName}`);
    }
    description = found.description;
  }

  const decision = evaluateXToolPolicy({ name: toolName, description });
  if (!decision.allowed) {
    throw new McpError(
      "policy",
      `Tool "${toolName}" blocked by read-only policy: ${decision.reason}`,
    );
  }
}

export function selectAllowedXTools(tools: McpTool[]): McpTool[] {
  return tools.filter((tool) => evaluateXToolPolicy(tool).allowed);
}

/** Subset of allowed tools that look like public post search (not mere user lookup). */
export function selectPublicPostSearchTools(tools: McpTool[]): McpTool[] {
  return selectAllowedXTools(tools).filter((tool) => {
    const { name, haystack } = haystackOf(tool);
    return (
      (/\bsearch\b/.test(haystack) &&
        /\b(post|posts|tweet|tweets|status|statuses|archive)\b/.test(
          haystack,
        )) ||
      /^search (posts|all|recent|archive|tweets)\b/.test(name)
    );
  });
}
