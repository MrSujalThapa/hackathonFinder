export type DiscordCommand = {
  action: "pause" | "continue" | "status" | "show_drafts" | "do_myself" | "show_qa" | "show_unanswered" | "show_question" | "discover";
  target?: string;
  questionNumber?: number;
  command?: string;
};

/** Caller must verify the Discord interaction signature before invoking this parser. */
export function parseDiscordCommand(authorId: string, content: string, ownerId: string | undefined): DiscordCommand | null {
  if (!ownerId || authorId !== ownerId) return null;
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "status") return { action: "status" };
  if (normalized === "show drafts") return { action: "show_drafts" };
  if (/^(find|search for|look for)\b/.test(normalized) && /\b(hackathons?|events?|fellowships?|competitions?|startup)\b/.test(normalized)) return { action: "discover", command: content.trim() };
  const question = /^show question (\d+) for (.+)$/.exec(normalized);
  if (question) return { action: "show_question", target: question[2], questionNumber: Number(question[1]) };
  const show = /^show (.+?) (q&a|questions and answers|unanswered)$/.exec(normalized);
  if (show) return { action: show[2] === "unanswered" ? "show_unanswered" : "show_qa", target: show[1] };
  const targetStatus = /^status (.+)$/.exec(normalized);
  if (targetStatus) return { action: "status", target: targetStatus[1] };
  const match = /^(pause|continue|do) (.+?)(?: myself)?$/.exec(normalized);
  if (!match) return null;
  if (match[1] === "do" && !/ myself$/.test(normalized)) return null;
  return { action: match[1] === "do" ? "do_myself" : match[1] as "pause" | "continue", target: match[2].replace(/ myself$/, "") };
}
