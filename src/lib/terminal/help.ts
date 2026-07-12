export const TERMINAL_HELP_LINES = [
  "Hackathon Finder discovery console — not a system shell.",
  "",
  "Natural language:",
  "  find upcoming AI hackathons in Toronto or remote",
  "  search all connected sources for robotics hackathons",
  "",
  "Commands:",
  "  /find <request>   Start a discovery run",
  "  /sources          Show source health",
  "  /status           Show active or latest job",
  "  /history          List recent discovery jobs",
  "  /cancel           Cancel the active run",
  "  /clear            Clear the console output",
  "  /help             Show this help",
  "",
  "Keys: Enter submit · Shift+Enter newline · ↑/↓ history",
] as const;

export function formatHelpText(): string {
  return TERMINAL_HELP_LINES.join("\n");
}
