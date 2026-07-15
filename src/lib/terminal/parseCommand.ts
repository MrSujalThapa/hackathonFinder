import type {
  ParsedTerminalCommand,
  SiteCommandAction,
  SourceCommandAction,
  TerminalHelpTopic,
  TerminalSourceName,
} from "@/lib/terminal/types";
import { TERMINAL_SOURCE_NAMES } from "@/lib/terminal/types";

const SHELL_BINARIES =
  /^(?:rm|curl|wget|powershell|pwsh|bash|sh|zsh|cmd(?:\.exe)?|npm|npx|node|yarn|pnpm|bun|deno|ssh|sudo|chmod|chown|kill|del|dir|ls|cat|echo|export|unset|env|python|python3|pip|git|docker|kubectl|brew|choco|scoop|apt|yum|pacman|Invoke-WebRequest|iwr|iex)\b/i;

const SHELL_OPERATORS = /(?:&&|\|\||[;|`]|>>?|<<?|\b2>&1\b)/;

const ENV_EXPANSION = /(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_][A-Za-z0-9_]*%)/;

const COMMAND_SUBSTITUTION = /\$\([^)]*\)|`[^`]+`/;

const URL_AS_COMMAND = /^(?:https?:\/\/|www\.)/i;

const PATH_AS_COMMAND = /^(?:~\/|\.\.?\/|[A-Za-z]:\\)/;

const SOURCE_ACTIONS = new Set<SourceCommandAction>([
  "status",
  "check",
  "connect",
  "disconnect",
  "enable",
  "disable",
]);

const SLASH_COMMANDS = [
  "find",
  "sources",
  "status",
  "history",
  "jobs",
  "cancel",
  "clear",
  "help",
  "new",
  "terminals",
  "switch",
  "rename",
  "close",
  "source",
  "site",
  "sites",
  "confirm",
] as const;

const ALLOWED_SLASH = new Set<string>(SLASH_COMMANDS);

const BARE_UTILITY = new Set([
  "help",
  "clear",
  "status",
  "history",
  "jobs",
  "cancel",
  "sources",
  "terminals",
]);

const HELP_TOPIC_ALIASES: Record<string, TerminalHelpTopic> = {
  general: "general",
  find: "find",
  source: "source",
  sources: "source",
  site: "source",
  sites: "source",
  terminal: "terminals",
  terminals: "terminals",
  session: "terminals",
  sessions: "terminals",
};

export const REJECTION_MESSAGE = [
  "This is a controlled discovery terminal, not a system shell.",
  "Try:",
  "  /find <request>",
  "  /source connect hakku",
  "  /help",
].join("\n");

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 0),
  );
  for (let i = 0; i < rows; i++) matrix[i]![0] = i;
  for (let j = 0; j < cols; j++) matrix[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[a.length]![b.length]!;
}

function suggestFrom(
  input: string,
  candidates: readonly string[],
  maxDistance = 2,
): string | undefined {
  const needle = input.toLowerCase();
  let best: string | undefined;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    const d = levenshtein(needle, candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return bestDistance <= maxDistance ? best : undefined;
}

export function suggestSlashCommand(name: string): string | undefined {
  const suggestion = suggestFrom(name, SLASH_COMMANDS);
  return suggestion ? `/${suggestion}` : undefined;
}

export function suggestSourceName(name: string): string | undefined {
  return suggestFrom(name, TERMINAL_SOURCE_NAMES);
}

export function isTerminalSourceName(value: string): value is TerminalSourceName {
  return (TERMINAL_SOURCE_NAMES as readonly string[]).includes(
    value.toLowerCase(),
  );
}

function looksLikeShell(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (SHELL_OPERATORS.test(trimmed)) {
    return "command chaining or redirection";
  }

  if (COMMAND_SUBSTITUTION.test(trimmed)) {
    return "command substitution";
  }

  if (ENV_EXPANSION.test(trimmed)) {
    return "environment variable expansion";
  }

  if (URL_AS_COMMAND.test(trimmed)) {
    return "URLs as commands";
  }

  if (PATH_AS_COMMAND.test(trimmed)) {
    return "filesystem paths as commands";
  }

  const withoutSlash = trimmed.startsWith("/")
    ? trimmed.slice(1).trim()
    : trimmed;

  const firstToken = (withoutSlash.split(/\s+/)[0] ?? "").toLowerCase();

  if (trimmed.startsWith("/") && ALLOWED_SLASH.has(firstToken)) {
    return null;
  }

  // Domain alias: `source status hakku` — not the shell builtin alone.
  if (firstToken === "source") {
    const parts = withoutSlash.split(/\s+/);
    if (parts.length >= 2 && SOURCE_ACTIONS.has(parts[1]!.toLowerCase() as SourceCommandAction)) {
      return null;
    }
  }

  // Domain aliases that collide with shell verbs.
  if (
    firstToken === "find" ||
    firstToken === "search" ||
    firstToken === "check" ||
    firstToken === "new" ||
    firstToken === "list" ||
    firstToken === "switch" ||
    firstToken === "rename" ||
    firstToken === "close" ||
    firstToken === "confirm" ||
    BARE_UTILITY.has(firstToken)
  ) {
    return null;
  }

  if (SHELL_BINARIES.test(withoutSlash) || SHELL_BINARIES.test(trimmed)) {
    return "system or package-manager commands";
  }

  if (/(?:^|\s)(?:>>?|<<?)(?:\s|$)/.test(trimmed)) {
    return "shell redirection";
  }

  return null;
}

function reject(
  reason: string,
  message: string,
  raw: string,
  suggestion?: string,
): ParsedTerminalCommand {
  return {
    kind: "rejected",
    reason,
    message,
    ...(suggestion ? { suggestion } : {}),
    raw,
  };
}

function resolveSource(
  token: string | undefined,
  raw: string,
  usage: string,
): TerminalSourceName | ParsedTerminalCommand {
  if (!token) {
    return reject("missing_source", usage, raw);
  }
  const lower = token.toLowerCase();
  if (isTerminalSourceName(lower)) {
    return lower;
  }
  const suggestion = suggestSourceName(lower);
  const message = suggestion
    ? `Unknown source "${token}".\nDid you mean "${suggestion}"?`
    : `Unknown source "${token}". Allowed: ${TERMINAL_SOURCE_NAMES.join(", ")}`;
  return reject("unknown_source", message, raw, suggestion);
}

function parseSourceCommand(
  actionToken: string | undefined,
  sourceToken: string | undefined,
  raw: string,
): ParsedTerminalCommand {
  if (!actionToken) {
    return reject(
      "missing_source_action",
      "Usage: /source <status|check|connect|disconnect|enable|disable> <source>",
      raw,
    );
  }
  const action = actionToken.toLowerCase();
  if (!SOURCE_ACTIONS.has(action as SourceCommandAction)) {
    const suggestion = suggestFrom(action, [...SOURCE_ACTIONS]);
    const message = suggestion
      ? `Unknown source action "${actionToken}".\nDid you mean "${suggestion}"?`
      : "Usage: /source <status|check|connect|disconnect|enable|disable> <source>";
    return reject("unknown_source_action", message, raw, suggestion);
  }
  const source = resolveSource(
    sourceToken,
    raw,
    `Usage: /source ${action} <source>`,
  );
  if (typeof source !== "string") return source;
  return {
    kind: "source",
    action: action as SourceCommandAction,
    source,
    raw,
  };
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function parseFlags(rest: string): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const parts = rest.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  for (const part of parts) {
    if (part.startsWith("--")) {
      const eq = part.indexOf("=");
      if (eq > 2) {
        flags[part.slice(2, eq).toLowerCase()] = stripQuotes(part.slice(eq + 1));
      }
    } else {
      positional.push(stripQuotes(part));
    }
  }
  return { positional, flags };
}

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  if (/^(true|1|yes|on)$/i.test(value)) return true;
  if (/^(false|0|no|off)$/i.test(value)) return false;
  return undefined;
}

function parseDiscoveryRequest(rawRequest: string, raw: string): ParsedTerminalCommand {
  const parts = rawRequest.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const queryParts: string[] = [];
  const sources: string[] = [];
  let includeCustomSites = false;
  let reviewPolicy: "broad" | "balanced" | "strict" | undefined;
  let profile: "light" | "standard" | "deep" | "exhaustive" | undefined;
  let dryRun = false;
  let remotePolicy: "exclude" | "include" | "only" | "inferred_open" | undefined;
  let onsiteOnly = false;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (!part.startsWith("--")) {
      queryParts.push(stripQuotes(part));
      continue;
    }
    const nextValue = () => {
      const value = parts[index + 1];
      if (!value || value.startsWith("--")) return undefined;
      index += 1;
      return stripQuotes(value);
    };
    if (part === "--include-custom-sites") {
      includeCustomSites = true;
      continue;
    }
    if (part === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (part === "--verbose") {
      continue;
    }
    if (part === "--remote") {
      remotePolicy = "only";
      continue;
    }
    if (part === "--include-remote") {
      remotePolicy = "include";
      continue;
    }
    if (part === "--onsite-only") {
      remotePolicy = "exclude";
      onsiteOnly = true;
      continue;
    }
    if (part === "--profile" || part.startsWith("--profile=")) {
      const value = part.includes("=")
        ? stripQuotes(part.slice("--profile=".length))
        : nextValue();
      if (
        value !== "light" &&
        value !== "standard" &&
        value !== "deep" &&
        value !== "exhaustive"
      ) {
        return reject("invalid_profile", "--profile must be light, standard, deep, or exhaustive", raw);
      }
      profile = value;
      continue;
    }
    if (part.startsWith("--sources=")) {
      const value = stripQuotes(part.slice("--sources=".length));
      if (!value.trim()) {
        return reject("invalid_discovery_sources", "--sources requires at least one source", raw);
      }
      sources.push(...value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
      continue;
    }
    if (part.startsWith("--review-policy=")) {
      const value = stripQuotes(part.slice("--review-policy=".length)).toLowerCase();
      if (value !== "broad" && value !== "balanced" && value !== "strict") {
        return reject("invalid_review_policy", "--review-policy must be broad, balanced, or strict", raw);
      }
      reviewPolicy = value;
      continue;
    }
    return reject("unknown_discovery_flag", `Unknown discovery flag "${part}"`, raw);
  }

  const request = queryParts.join(" ").trim();
  if (!request) {
    return reject("missing_request", "Usage: /find <discovery request>", raw);
  }
  return {
    kind: "find",
    request,
    raw,
    ...(includeCustomSites ? { includeCustomSites } : {}),
    ...(sources.length > 0 ? { sources: [...new Set(sources)] } : {}),
    ...(reviewPolicy ? { reviewPolicy } : {}),
    ...(profile ? { profile } : {}),
    ...(dryRun ? { dryRun } : {}),
    ...(remotePolicy ? { remotePolicy } : {}),
    ...(onsiteOnly ? { onsiteOnly } : {}),
  };
}

function parseSiteCommand(actionToken: string | undefined, rest: string, raw: string): ParsedTerminalCommand {
  const action = actionToken?.toLowerCase();
  if (!action) return reject("missing_site_action", "Usage: /site <save|status|check|enable|disable|remove|configure> <name>", raw);
  if (action === "list") return { kind: "site", action: "list", raw };
  if (!["save", "status", "check", "enable", "disable", "remove", "configure"].includes(action)) {
    return reject("unknown_site_action", "Usage: /site <save|status|check|enable|disable|remove|configure> <name>", raw);
  }
  const parsed = parseFlags(rest);
  const name = parsed.positional[0];
  if (!name) return reject("missing_site_name", `Usage: /site ${action} <name>`, raw);
  const mode = parsed.flags.mode?.toLowerCase();
  if (mode && mode !== "auto" && mode !== "static" && mode !== "playwright") {
    return reject("invalid_site_mode", "--mode must be auto, static, or playwright", raw);
  }
  const strategy = parsed.flags.strategy?.toLowerCase();
  if (strategy && strategy !== "auto" && strategy !== "cards" && strategy !== "table" && strategy !== "list") {
    return reject("invalid_site_strategy", "--strategy must be auto, cards, table, or list", raw);
  }
  const maxItems = parsed.flags["max-items"] ? Number(parsed.flags["max-items"]) : undefined;
  if (maxItems !== undefined && (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100)) {
    return reject("invalid_site_max_items", "--max-items must be an integer from 1 to 100", raw);
  }
  return {
    kind: "site",
    action: action as SiteCommandAction,
    name,
    url: parsed.flags.url,
    mode: mode as "auto" | "static" | "playwright" | undefined,
    location: parsed.flags.location,
    topics: parsed.flags.topics?.split(",").map((topic) => topic.trim()).filter(Boolean),
    maxItems,
    enabled: parseBooleanFlag(parsed.flags.enabled),
    selectors: {
      cardSelector: parsed.flags["card-selector"],
      titleSelector: parsed.flags["title-selector"],
      linkSelector: parsed.flags["link-selector"],
      strategy: strategy as "auto" | "cards" | "table" | "list" | undefined,
      titleColumn: parsed.flags["title-column"],
      dateColumn: parsed.flags["date-column"],
      typeColumn: parsed.flags["type-column"],
      urlColumn: parsed.flags["url-column"],
    },
    raw,
  } as ParsedTerminalCommand;
}

function parseHelpTopic(rest: string): TerminalHelpTopic | ParsedTerminalCommand {
  const topicToken = rest.trim().split(/\s+/)[0]?.toLowerCase();
  if (!topicToken) return "general";
  const mapped = HELP_TOPIC_ALIASES[topicToken];
  if (mapped) return mapped;
  const suggestion = suggestFrom(topicToken, Object.keys(HELP_TOPIC_ALIASES));
  return reject(
    "unknown_help_topic",
    suggestion
      ? `Unknown help topic "${topicToken}".\nDid you mean "${suggestion}"?\nTry /help, /help find, /help source, or /help terminals.`
      : `Unknown help topic "${topicToken}". Try /help, /help find, /help source, or /help terminals.`,
    rest,
    suggestion,
  );
}

function parseSlash(
  name: string,
  rest: string,
  raw: string,
): ParsedTerminalCommand {
  switch (name) {
    case "find": {
      const request = rest.trim();
      if (!request) {
        return reject(
          "missing_request",
          "Usage: /find <discovery request>",
          raw,
        );
      }
      return parseDiscoveryRequest(request, raw);
    }
    case "sources":
      return { kind: "sources", raw };
    case "status":
      return { kind: "status", raw };
    case "history":
      return { kind: "history", raw };
    case "jobs":
      return { kind: "jobs", raw };
    case "cancel": {
      const jobId = rest.trim().split(/\s+/)[0] || undefined;
      return { kind: "cancel", ...(jobId ? { jobId } : {}), raw };
    }
    case "clear":
      return { kind: "clear", raw };
    case "help": {
      const topicOrReject = parseHelpTopic(rest);
      if (typeof topicOrReject !== "string") {
        // parseHelpTopic used rest as raw — rebuild with full raw
        return {
          ...topicOrReject,
          raw,
        };
      }
      return { kind: "help", topic: topicOrReject, raw };
    }
    case "new":
      return { kind: "new", raw };
    case "terminals":
      return { kind: "terminals", raw };
    case "switch": {
      const target = rest.trim();
      if (!target) {
        return reject("missing_target", "Usage: /switch <id|name>", raw);
      }
      return { kind: "switch", target, raw };
    }
    case "rename": {
      const nameArg = rest.trim();
      if (!nameArg) {
        return reject("missing_name", "Usage: /rename <name>", raw);
      }
      return { kind: "rename", name: nameArg, raw };
    }
    case "close": {
      const target = rest.trim() || undefined;
      return { kind: "close", ...(target ? { target } : {}), raw };
    }
    case "source": {
      const parts = rest.trim().split(/\s+/).filter(Boolean);
      return parseSourceCommand(parts[0], parts[1], raw);
    }
    case "sites":
      return { kind: "site", action: "list", raw };
    case "site": {
      const parts = rest.trim().split(/\s+/).filter(Boolean);
      const action = parts[0];
      const restAfterAction = rest.trim().slice(action?.length ?? 0).trim();
      return parseSiteCommand(action, restAfterAction, raw);
    }
    case "confirm": {
      const parts = rest.trim().split(/\s+/).filter(Boolean);
      const action = parts[0]?.toLowerCase();
      if (action === "site" && parts[1]?.toLowerCase() === "remove" && parts[2]) {
        return { kind: "confirm_site", action: "remove", name: parts[2], raw };
      }
      if (action !== "disconnect") {
        return reject(
          "unknown_confirm_action",
          "Usage: /confirm disconnect <source> or /confirm site remove <name>",
          raw,
        );
      }
      const source = resolveSource(
        parts[1],
        raw,
        "Usage: /confirm disconnect <source>",
      );
      if (typeof source !== "string") return source;
      return { kind: "confirm", action: "disconnect", source, raw };
    }
    default: {
      const suggestion = suggestSlashCommand(name);
      const message = suggestion
        ? `Unknown command "/${name}".\nDid you mean "${suggestion}"?`
        : `Unknown command /${name}. Try /help.`;
      return reject("unknown_command", message, raw, suggestion);
    }
  }
}

function parseAlias(trimmed: string, raw: string): ParsedTerminalCommand | null {
  const lower = trimmed.toLowerCase();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const first = tokens[0]?.toLowerCase() ?? "";

  // Bare utilities: help / clear / status / …
  if (tokens.length === 1 && BARE_UTILITY.has(first)) {
    return parseSlash(first, "", raw);
  }

  // help <topic>
  if (first === "help" && tokens.length >= 2) {
    return parseSlash("help", tokens.slice(1).join(" "), raw);
  }

  // source <action> <name>
  if (first === "source") {
    return parseSourceCommand(tokens[1], tokens[2], raw);
  }

  if (first === "sites") {
    return { kind: "site", action: "list", raw };
  }

  if (first === "site") {
    const action = tokens[1];
    const restAfterAction = trimmed.split(/\s+/).slice(2).join(" ");
    return parseSiteCommand(action, restAfterAction, raw);
  }

  // check source <name>  |  check <name>
  if (first === "check") {
    if (tokens[1]?.toLowerCase() === "source") {
      return parseSourceCommand("check", tokens[2], raw);
    }
    if (tokens[1] && isTerminalSourceName(tokens[1].toLowerCase())) {
      return parseSourceCommand("check", tokens[1], raw);
    }
  }

  // confirm disconnect <source>
  if (first === "confirm") {
    return parseSlash("confirm", tokens.slice(1).join(" "), raw);
  }

  // new terminal
  if (first === "new" && (tokens.length === 1 || tokens[1]?.toLowerCase() === "terminal")) {
    return { kind: "new", raw };
  }

  // list terminals
  if (
    (first === "list" && tokens[1]?.toLowerCase() === "terminals") ||
    lower === "list terminals"
  ) {
    return { kind: "terminals", raw };
  }

  // switch terminal <target>  |  switch <target>
  if (first === "switch") {
    const target =
      tokens[1]?.toLowerCase() === "terminal"
        ? tokens.slice(2).join(" ").trim()
        : tokens.slice(1).join(" ").trim();
    if (!target) {
      return reject("missing_target", "Usage: /switch <id|name>", raw);
    }
    return { kind: "switch", target, raw };
  }

  // rename terminal <name>  |  rename <name>
  if (first === "rename") {
    const name =
      tokens[1]?.toLowerCase() === "terminal"
        ? tokens.slice(2).join(" ").trim()
        : tokens.slice(1).join(" ").trim();
    if (!name) {
      return reject("missing_name", "Usage: /rename <name>", raw);
    }
    return { kind: "rename", name, raw };
  }

  // close terminal [target]
  if (first === "close") {
    if (tokens[1]?.toLowerCase() === "terminal") {
      const target = tokens.slice(2).join(" ").trim() || undefined;
      return { kind: "close", ...(target ? { target } : {}), raw };
    }
    if (tokens.length === 1) {
      return { kind: "close", raw };
    }
  }

  // find|search <request>
  if (first === "find" || first === "search") {
    const request = tokens.slice(1).join(" ").trim();
    if (!request) {
      return reject(
        "missing_request",
        "Usage: /find <discovery request>",
        raw,
      );
    }
    return parseDiscoveryRequest(request, raw);
  }

  return null;
}

/**
 * Parse a terminal input line into a domain command or a friendly rejection.
 * Never executes shell — this is validation only.
 */
export function parseTerminalCommand(input: string): ParsedTerminalCommand {
  const raw = input;
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: "empty", raw };
  }

  const shellReason = looksLikeShell(trimmed);
  if (shellReason) {
    return reject(shellReason, REJECTION_MESSAGE, raw);
  }

  if (trimmed.startsWith("/")) {
    const body = trimmed.slice(1).trim();
    const space = body.search(/\s/);
    const name = (space < 0 ? body : body.slice(0, space)).toLowerCase();
    const rest = space < 0 ? "" : body.slice(space + 1);
    if (!name) {
      return reject("empty_slash", "Unknown command. Try /help.", raw);
    }
    if (!ALLOWED_SLASH.has(name)) {
      const suggestion = suggestSlashCommand(name);
      const message = suggestion
        ? `Unknown command "/${name}".\nDid you mean "${suggestion}"?`
        : `Unknown command /${name}. Try /help.`;
      return reject("unknown_command", message, raw, suggestion);
    }
    return parseSlash(name, rest, raw);
  }

  const aliased = parseAlias(trimmed, raw);
  if (aliased) return aliased;

  // Natural language discovery request.
  return parseDiscoveryRequest(trimmed, raw);
}

export function isActiveJobStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return !["completed", "failed", "cancelled"].includes(status);
}

export { ALLOWED_SLASH, SLASH_COMMANDS, SOURCE_ACTIONS };
