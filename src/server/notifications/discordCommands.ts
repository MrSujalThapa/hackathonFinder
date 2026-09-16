export type DiscordCommand = { action: "pause" | "continue" | "status" | "show_drafts" | "do_myself"; target?: string };

/** Caller must verify the Discord interaction signature before invoking this parser. */
export function parseDiscordCommand(authorId: string, content: string, ownerId: string | undefined): DiscordCommand | null {
  if (!ownerId || authorId !== ownerId) return null;
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "status") return { action: "status" };
  if (normalized === "show drafts") return { action: "show_drafts" };
  const match = /^(pause|continue|do) (.+?)(?: myself)?$/.exec(normalized);
  if (!match) return null;
  if (match[1] === "do" && !/ myself$/.test(normalized)) return null;
  return { action: match[1] === "do" ? "do_myself" : match[1] as "pause" | "continue", target: match[2].replace(/ myself$/, "") };
}
