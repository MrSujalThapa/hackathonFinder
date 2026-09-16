import assert from "node:assert/strict";
import test from "node:test";
import { parseDiscordCommand } from "@/server/notifications/discordCommands";
test("Discord command parsing permits only the configured owner", () => {
  assert.equal(parseDiscordCommand("other-user", "pause hackmit", "owner"), null);
  assert.deepEqual(parseDiscordCommand("owner", "pause HackMIT", "owner"), { action: "pause", target: "hackmit" });
  assert.deepEqual(parseDiscordCommand("owner", "do hackmit myself", "owner"), { action: "do_myself", target: "hackmit" });
  assert.deepEqual(parseDiscordCommand("owner", "show drafts", "owner"), { action: "show_drafts" });
});
