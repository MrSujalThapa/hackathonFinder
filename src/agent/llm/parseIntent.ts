import { parseCommand } from "@/agent/parseCommand";
import { agentIntentSchema, type AgentIntent } from "./schemas";

function looksLikeDiscoveryCommand(command: string): boolean {
  return /\b(find|search|discover|hackathon|hackathons|buildathon|codefest)\b/i.test(command);
}

export function parseIntent(rawCommand: string): AgentIntent {
  const command = rawCommand.trim();
  if (!command) {
    return agentIntentSchema.parse({
      kind: "unknown",
      rawCommand,
      confidence: 0,
      warnings: ["Command is empty."],
    });
  }

  if (!looksLikeDiscoveryCommand(command)) {
    return agentIntentSchema.parse({
      kind: "unknown",
      rawCommand: command,
      confidence: 0.25,
      warnings: ["Command does not look like a hackathon discovery request."],
    });
  }

  return agentIntentSchema.parse({
    kind: "discover_hackathons",
    rawCommand: command,
    preferences: parseCommand(command),
    confidence: 0.9,
    warnings: [],
  });
}
