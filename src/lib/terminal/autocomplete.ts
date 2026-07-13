import {
  ALLOWED_SLASH,
  SOURCE_ACTIONS,
  isTerminalSourceName,
} from "@/lib/terminal/parseCommand";
import { TERMINAL_SOURCE_NAMES } from "@/lib/terminal/types";

export type AutocompleteContext = {
  /** Open terminal session titles / ids for /switch and /close. */
  terminalNames?: string[];
  /** Recent job ids for /cancel. */
  recentJobIds?: string[];
};

const ROOT_COMMANDS = [...ALLOWED_SLASH].map((name) => `/${name}`);

const SOURCE_ACTION_LIST = [...SOURCE_ACTIONS];

function uniquePreserve(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function filterPrefix(candidates: string[], prefix: string): string[] {
  const lower = prefix.toLowerCase();
  if (!lower) return [...candidates];
  return candidates.filter((c) => c.toLowerCase().startsWith(lower));
}

/**
 * Tab-completion suggestions for the discovery terminal.
 * Returns replacement prefixes for the current token (not full lines).
 */
export function getAutocompleteSuggestions(
  input: string,
  cursorPosition: number = input.length,
  context: AutocompleteContext = {},
): string[] {
  const before = input.slice(0, Math.max(0, cursorPosition));
  const endsWithSpace = /\s$/.test(before);
  const trimmed = before.trim();
  const tokens = trimmed.length ? trimmed.split(/\s+/) : [];
  const current = endsWithSpace ? "" : (tokens[tokens.length - 1] ?? "");
  const prior = endsWithSpace ? tokens : tokens.slice(0, Math.max(0, tokens.length - 1));
  const priorLower = prior.map((t) => t.toLowerCase());

  // First token: slash commands or bare aliases.
  if (prior.length === 0) {
    const slash = filterPrefix(ROOT_COMMANDS, current.startsWith("/") ? current : `/${current}`);
    const bare = filterPrefix(
      [
        "find",
        "search",
        "source",
        "check",
        "new",
        "list",
        "switch",
        "rename",
        "close",
        "help",
        "clear",
        "status",
        "history",
        "jobs",
        "cancel",
        "sources",
        "terminals",
        "confirm",
      ],
      current,
    );
    if (current.startsWith("/")) {
      return uniquePreserve(slash);
    }
    return uniquePreserve([...bare, ...slash]);
  }

  const head = priorLower[0] ?? "";
  const headBare = head.startsWith("/") ? head.slice(1) : head;

  // /help <topic> | help <topic>
  if (headBare === "help") {
    return filterPrefix(["find", "source", "terminals", "general"], current);
  }

  // /source <action> <source> | source <action> <source>
  if (headBare === "source") {
    if (prior.length === 1) {
      return filterPrefix(SOURCE_ACTION_LIST, current);
    }
    if (prior.length === 2 && SOURCE_ACTIONS.has(priorLower[1] as never)) {
      return filterPrefix([...TERMINAL_SOURCE_NAMES], current);
    }
  }

  // check source <name>
  if (headBare === "check") {
    if (prior.length === 1) {
      const sources = filterPrefix([...TERMINAL_SOURCE_NAMES], current);
      const sourceWord = filterPrefix(["source"], current);
      return uniquePreserve([...sourceWord, ...sources]);
    }
    if (prior.length === 2 && priorLower[1] === "source") {
      return filterPrefix([...TERMINAL_SOURCE_NAMES], current);
    }
  }

  // /confirm disconnect <source>
  if (headBare === "confirm") {
    if (prior.length === 1) {
      return filterPrefix(["disconnect"], current);
    }
    if (prior.length === 2 && priorLower[1] === "disconnect") {
      return filterPrefix([...TERMINAL_SOURCE_NAMES], current);
    }
  }

  // /cancel [jobId]
  if (headBare === "cancel" && prior.length === 1) {
    return filterPrefix(context.recentJobIds ?? [], current);
  }

  // /switch|/close|/rename targets
  if (
    (headBare === "switch" || headBare === "close" || headBare === "rename") &&
    prior.length === 1
  ) {
    const names = context.terminalNames ?? [];
    if (headBare === "switch" || headBare === "close") {
      const withTerminal = filterPrefix(["terminal", ...names], current);
      return uniquePreserve(withTerminal);
    }
    return filterPrefix(["terminal", ...names], current);
  }

  // switch terminal <name> | close terminal <name> | rename terminal <name>
  if (
    (headBare === "switch" || headBare === "close" || headBare === "rename") &&
    prior.length === 2 &&
    priorLower[1] === "terminal"
  ) {
    return filterPrefix(context.terminalNames ?? [], current);
  }

  // new terminal
  if (headBare === "new" && prior.length === 1) {
    return filterPrefix(["terminal"], current);
  }

  // list terminals
  if (headBare === "list" && prior.length === 1) {
    return filterPrefix(["terminals"], current);
  }

  // After find/search — no structured completion.
  if (headBare === "find" || headBare === "search") {
    return [];
  }

  // If completing a known source name mid-command, offer sources.
  if (current && !current.startsWith("/") && !isTerminalSourceName(current)) {
    const sourceHits = filterPrefix([...TERMINAL_SOURCE_NAMES], current);
    if (sourceHits.length) return sourceHits;
  }

  return [];
}

/**
 * Apply the next autocomplete match: replaces the current token with `suggestion`.
 * Cycles when `cycleOffset` is provided (Tab / repeated Tab).
 */
export function applyAutocomplete(
  input: string,
  suggestion: string,
  cursorPosition: number = input.length,
): { value: string; cursor: number } {
  const before = input.slice(0, Math.max(0, cursorPosition));
  const after = input.slice(Math.max(0, cursorPosition));
  const tokenStart = Math.max(before.lastIndexOf(" ") + 1, before.lastIndexOf("\t") + 1);
  const head = before.slice(0, tokenStart);
  const next = `${head}${suggestion}`;
  const needsSpace = !after.startsWith(" ") && !suggestion.endsWith(" ");
  const value = needsSpace ? `${next} ${after.replace(/^\s*/, "")}` : `${next}${after}`;
  const cursor = needsSpace ? next.length + 1 : next.length;
  return { value, cursor };
}

export function cycleAutocomplete(
  input: string,
  cursorPosition: number,
  context: AutocompleteContext,
  cycleIndex: number,
): { value: string; cursor: number; suggestions: string[]; index: number } | null {
  const suggestions = getAutocompleteSuggestions(input, cursorPosition, context);
  if (!suggestions.length) return null;
  const index = ((cycleIndex % suggestions.length) + suggestions.length) % suggestions.length;
  const applied = applyAutocomplete(input, suggestions[index]!, cursorPosition);
  return { ...applied, suggestions, index };
}
