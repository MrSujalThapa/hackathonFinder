import assert from "node:assert/strict";
import test from "node:test";
import { parseDiscordCommand } from "@/server/notifications/discordCommands";
test("Discord command parsing permits only the configured owner", () => {
  assert.equal(parseDiscordCommand("other-user", "pause hackmit", "owner"), null);
  assert.deepEqual(parseDiscordCommand("owner", "pause HackMIT", "owner"), { action: "pause", target: "hackmit" });
  assert.deepEqual(parseDiscordCommand("owner", "do hackmit myself", "owner"), { action: "do_myself", target: "hackmit" });
  assert.deepEqual(parseDiscordCommand("owner", "show drafts", "owner"), { action: "show_drafts" });
  assert.deepEqual(parseDiscordCommand("owner", "show hackmit q&a", "owner"), { action: "show_qa", target: "hackmit" });
  assert.deepEqual(parseDiscordCommand("owner", "show question 4 for hackmit", "owner"), { action: "show_question", target: "hackmit", questionNumber: 4 });
  assert.deepEqual(parseDiscordCommand("owner", "find hackathons in Ottawa this month", "owner"), { action: "discover", command: "find hackathons in Ottawa this month" });
  assert.deepEqual(parseDiscordCommand("owner", "show hackmit draft", "owner"), { action: "show_draft", target: "hackmit" });
  assert.deepEqual(parseDiscordCommand("owner", "delete hackmit draft", "owner"), { action: "delete_draft", target: "hackmit" });
});
