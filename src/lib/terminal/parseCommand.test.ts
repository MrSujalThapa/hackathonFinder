import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseTerminalCommand,
  REJECTION_MESSAGE,
} from "@/lib/terminal/parseCommand";

describe("parseTerminalCommand", () => {
  it("accepts natural language discovery requests", () => {
    const parsed = parseTerminalCommand(
      "find upcoming AI hackathons in Toronto or remote",
    );
    assert.equal(parsed.kind, "find");
    if (parsed.kind === "find") {
      assert.match(parsed.request, /Toronto/);
    }
  });

  it("parses /find with request", () => {
    const parsed = parseTerminalCommand("/find student hackathons in Canada");
    assert.equal(parsed.kind, "find");
    if (parsed.kind === "find") {
      assert.equal(parsed.request, "student hackathons in Canada");
    }
  });

  it("rejects empty /find", () => {
    const parsed = parseTerminalCommand("/find");
    assert.equal(parsed.kind, "rejected");
  });

  it("parses slash utilities", () => {
    for (const cmd of [
      "/sources",
      "/status",
      "/history",
      "/cancel",
      "/clear",
      "/help",
    ]) {
      const parsed = parseTerminalCommand(cmd);
      assert.notEqual(parsed.kind, "rejected", cmd);
      assert.notEqual(parsed.kind, "find", cmd);
    }
  });

  it("rejects shell-like binaries with a friendly message", () => {
    for (const cmd of [
      "rm -rf /",
      "curl https://example.com",
      "powershell Get-Process",
      "bash -c ls",
      "npm install",
      "node -e process.exit()",
    ]) {
      const parsed = parseTerminalCommand(cmd);
      assert.equal(parsed.kind, "rejected", cmd);
      if (parsed.kind === "rejected") {
        assert.equal(parsed.message, REJECTION_MESSAGE);
      }
    }
  });

  it("rejects chaining, pipes, and redirection", () => {
    for (const cmd of [
      "find foo && rm -rf /",
      "find foo | curl x",
      "find foo; npm test",
      "find foo > out.txt",
    ]) {
      const parsed = parseTerminalCommand(cmd);
      assert.equal(parsed.kind, "rejected", cmd);
    }
  });

  it("rejects bare URLs as commands", () => {
    const parsed = parseTerminalCommand("https://evil.example/path");
    assert.equal(parsed.kind, "rejected");
  });

  it("rejects unknown slash commands", () => {
    const parsed = parseTerminalCommand("/exec something");
    assert.equal(parsed.kind, "rejected");
    if (parsed.kind === "rejected") {
      assert.match(parsed.message, /Unknown command/);
    }
  });

  it("treats empty input as empty", () => {
    assert.equal(parseTerminalCommand("   ").kind, "empty");
  });
});
