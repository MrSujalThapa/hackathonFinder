import type { TerminalHelpTopic } from "@/lib/terminal/types";
import { TERMINAL_SOURCE_NAMES } from "@/lib/terminal/types";
import { SLASH_COMMANDS } from "@/lib/terminal/parseCommand";

export const TERMINAL_HELP_LINES = [
  "Hackathon Finder discovery terminal",
  "",
  "Search / Discovery",
  "  /find <request>                         Start discovery (find/search/plain text also work)",
  "  /sources                                List source health",
  "  /status | /history | /jobs | /cancel [id]  Inspect or cancel jobs",
  "",
  "Source management",
  "  /source <status|check|connect|disconnect|enable|disable> <name>",
  "  /check|/enable|/disable|/connect|/disconnect <name>  Short aliases",
  "  /confirm disconnect <name>               Confirm source disconnect",
  "",
  "Custom sites",
  "  /site save <name> --url=<listing-url> [--mode=auto|static|playwright]",
  "  /site status|check|enable|disable|remove <name> | /sites",
  "  /site configure <name> [--strategy=auto|cards|table|list …]",
  "  /confirm site remove <name>",
  "",
  "Terminal sessions",
  "  /new",
  "  /terminals",
  "  /switch <id|name>",
  "  /rename <name>",
  "  /close",
  "",
  "Console",
  "  /clear | /help [find|source|terminals]",
  "",
  `All slash commands: ${SLASH_COMMANDS.map((command) => `/${command}`).join(", ")}`,
  "",
  "Examples",
  "  /source status hakku",
  "  /source connect hakku",
  "  /site save hacker-calendar --url=https://example.com/hackathons --mode=auto",
  "  /site configure hacker-calendar --strategy=table --title-column=\"Title\" --date-column=\"Start Date\" --url-column=\"Website\"",
  "  find AI hackathons in Toronto",
  "  find hackathons in Ottawa in person",
  "  find AI hackathons in San Francisco or remote",
  "  find hackathons in Ontario",
  "  find remote hackathons",
  "  find AI hackathons --profile deep",
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
  "Flags (removed from planner text):",
  "  --profile light|standard|deep|exhaustive",
  "  --include-remote | --remote | --onsite-only",
  "  --dry-run | --verbose",
  "  --sources=<builtin-or-custom>",
  "",
  "Examples:",
  "  /find upcoming AI hackathons in Toronto or remote",
  "  find upcoming AI hackathons in Toronto --profile light --dry-run",
  "  find remote AI hackathons in the next 6 months --profile deep",
  "  find AI hackathons from Devpost in the next 6 months --profile deep --dry-run",
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
