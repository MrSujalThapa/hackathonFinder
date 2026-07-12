import type { ParsedTerminalCommand } from "@/lib/terminal/types";

const SHELL_BINARIES =
  /^(?:rm|curl|wget|powershell|pwsh|bash|sh|zsh|cmd|npm|npx|node|yarn|pnpm|bun|deno|ssh|sudo|chmod|chown|kill|del|dir|ls|cat|echo|export|unset|env|python|python3|pip|git|docker|kubectl|brew|choco|scoop|apt|yum|pacman|Invoke-WebRequest|iwr|iex)\b/i;

const SHELL_OPERATORS = /(?:&&|\|\||[;|`]|>>?|<<?|\b2>&1\b)/;

const URL_AS_COMMAND =
  /^(?:https?:\/\/|www\.)/i;

const PATH_AS_COMMAND = /^(?:~\/|\.\.?\/|[A-Za-z]:\\)/;

const ALLOWED_SLASH = new Set([
  "find",
  "sources",
  "status",
  "history",
  "cancel",
  "clear",
  "help",
]);

const REJECTION_MESSAGE =
  "This console only accepts discovery commands — not shell or system commands. Try /help.";

function looksLikeShell(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (SHELL_OPERATORS.test(trimmed)) {
    return "command chaining or redirection";
  }

  if (URL_AS_COMMAND.test(trimmed)) {
    return "URLs as commands";
  }

  if (PATH_AS_COMMAND.test(trimmed)) {
    return "filesystem paths as commands";
  }

  // Strip a leading slash only for binary detection of `/rm` style, not `/find`.
  const withoutSlash = trimmed.startsWith("/")
    ? trimmed.slice(1).trim()
    : trimmed;

  const firstToken = withoutSlash.split(/\s+/)[0] ?? "";
  const slashName = firstToken.toLowerCase();

  if (trimmed.startsWith("/") && ALLOWED_SLASH.has(slashName)) {
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

function parseSlash(
  name: string,
  rest: string,
  raw: string,
): ParsedTerminalCommand {
  switch (name) {
    case "find": {
      const request = rest.trim();
      if (!request) {
        return {
          kind: "rejected",
          reason: "missing_request",
          message: "Usage: /find <discovery request>",
          raw,
        };
      }
      return { kind: "find", request, raw };
    }
    case "sources":
      return { kind: "sources", raw };
    case "status":
      return { kind: "status", raw };
    case "history":
      return { kind: "history", raw };
    case "cancel":
      return { kind: "cancel", raw };
    case "clear":
      return { kind: "clear", raw };
    case "help":
      return { kind: "help", raw };
    default:
      return {
        kind: "rejected",
        reason: "unknown_command",
        message: `Unknown command /${name}. Try /help.`,
        raw,
      };
  }
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
    return {
      kind: "rejected",
      reason: shellReason,
      message: REJECTION_MESSAGE,
      raw,
    };
  }

  if (trimmed.startsWith("/")) {
    const body = trimmed.slice(1).trim();
    const space = body.search(/\s/);
    const name = (space < 0 ? body : body.slice(0, space)).toLowerCase();
    const rest = space < 0 ? "" : body.slice(space + 1);
    if (!name) {
      return {
        kind: "rejected",
        reason: "empty_slash",
        message: "Unknown command. Try /help.",
        raw,
      };
    }
    if (!ALLOWED_SLASH.has(name)) {
      // Unknown slash — still reject shell-looking first tokens already handled.
      return {
        kind: "rejected",
        reason: "unknown_command",
        message: `Unknown command /${name}. Try /help.`,
        raw,
      };
    }
    return parseSlash(name, rest, raw);
  }

  // Natural language discovery request.
  return { kind: "find", request: trimmed, raw };
}

export function isActiveJobStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return ![
    "completed",
    "failed",
    "cancelled",
  ].includes(status);
}

export { REJECTION_MESSAGE, ALLOWED_SLASH };
