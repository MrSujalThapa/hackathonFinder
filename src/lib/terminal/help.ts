import type { TerminalHelpTopic } from "@/lib/terminal/types";
import { TERMINAL_SOURCE_NAMES } from "@/lib/terminal/types";

export const TERMINAL_HELP_LINES = [
  "Hackathon Finder discovery terminal",
  "",
  "Discovery",
  "  /find <request>",
  "  /sources",
  "  /status",
  "  /history",
  "  /jobs",
  "  /cancel",
  "",
  "Source management",
  "  /source status <name>",
  "  /source check <name>",
  "  /source connect <name>",
  "  /source disconnect <name>",
  "  /source enable <name>",
  "  /source disable <name>",
  "",
  "Saved sites",
  "  /site save <name> --url=<listing-url>",
  "  /site check <name>",
  "  /sites",
  "  /site enable <name>",
  "  /site disable <name>",
  "  /site remove <name>",
  "",
  "Terminal sessions",
  "  /new",
  "  /terminals",
  "  /switch <id|name>",
  "  /rename <name>",
  "  /close",
  "",
  "Console",
  "  /clear",
  "  /help",
  "",
  "Examples",
  "  /source status hakku",
  "  /source connect hakku",
  "  /site save hacker-calendar --url=https://example.com/hackathons --mode=playwright",
  "  /find upcoming AI hackathons in Canada or remote",
  "",
  "Keys: Enter submit · Shift+Enter newline · ↑/↓ history · Tab complete",
] as const;

const HELP_FIND = [
  "Find — start a discovery run",
  "",
  "Usage:",
  "  /find <request>",
  "  find <request>",
  "  search <request>",
  "  <natural language request>",
  "",
  "Examples:",
  "  /find upcoming AI hackathons in Toronto or remote",
  "  find student hackathons in Canada",
  "  search all connected sources for robotics hackathons",
] as const;

const HELP_SOURCE = [
  "Source management",
  "",
  "Usage:",
  "  /source <status|check|connect|disconnect|enable|disable> <name>",
  "  source <action> <name>",
  "  check source <name>",
  "",
  `Sources: ${TERMINAL_SOURCE_NAMES.join(", ")}`,
  "",
  "Examples:",
  "  /source status hakku",
  "  /source check devpost",
  "  /source connect hakku",
  "  /source disconnect hakku",
  "  source enable luma",
  "",
  "Confirm a pending disconnect with:",
  "  /confirm disconnect <name>",
] as const;

const HELP_TERMINALS = [
  "Terminal sessions",
  "",
  "Usage:",
  "  /new                 Create a new session",
  "  /terminals           List open sessions",
  "  /switch <id|name>    Switch to a session",
  "  /rename <name>       Rename the current session",
  "  /close [id|name]     Close current or named session",
  "",
  "Aliases:",
  "  new terminal",
  "  list terminals",
  "  switch terminal <name>",
  "  rename terminal <name>",
  "  close terminal",
] as const;

export function formatHelpText(topic: TerminalHelpTopic = "general"): string {
  switch (topic) {
    case "find":
      return HELP_FIND.join("\n");
    case "source":
      return HELP_SOURCE.join("\n");
    case "terminals":
      return HELP_TERMINALS.join("\n");
    case "general":
    default:
      return TERMINAL_HELP_LINES.join("\n");
  }
}
