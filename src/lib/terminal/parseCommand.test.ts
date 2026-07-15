import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseTerminalCommand,
  REJECTION_MESSAGE,
  suggestSlashCommand,
  suggestSourceName,
} from "@/lib/terminal/parseCommand";
import { formatHelpText, TERMINAL_HELP_LINES } from "@/lib/terminal/help";

describe("parseTerminalCommand", () => {
  it("accepts natural language discovery requests", () => {
    const parsed = parseTerminalCommand(
      "upcoming AI hackathons in Toronto or remote",
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

  it("parses discovery flags and removes them from the natural-language request", () => {
    const parsed = parseTerminalCommand(
      "upcoming hackathons --include-custom-sites --sources=hackathonmap,hackathonradar --review-policy=broad --profile light --include-remote --dry-run --verbose",
    );
    assert.equal(parsed.kind, "find");
    if (parsed.kind !== "find") return;
    assert.equal(parsed.request, "upcoming hackathons");
    assert.equal(parsed.includeCustomSites, true);
    assert.deepEqual(parsed.sources, ["hackathonmap", "hackathonradar"]);
    assert.equal(parsed.reviewPolicy, "broad");
    assert.equal(parsed.profile, "light");
    assert.equal(parsed.remotePolicy, "include");
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.verbose, true);
    assert.equal(parsed.request.includes("--verbose"), false);
  });

  it("parses terminal page profile and remote flags with space syntax", () => {
    const parsed = parseTerminalCommand(
      "find upcoming AI hackathons in Toronto --profile deep --remote --dry-run",
    );
    assert.equal(parsed.kind, "find");
    if (parsed.kind !== "find") return;
    assert.equal(parsed.request, "upcoming AI hackathons in Toronto");
    assert.equal(parsed.profile, "deep");
    assert.equal(parsed.remotePolicy, "only");
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.request.includes("--profile"), false);
  });

  it("rejects unknown discovery flags", () => {
    const parsed = parseTerminalCommand("upcoming hackathons --wat");
    assert.equal(parsed.kind, "rejected");
    if (parsed.kind === "rejected") {
      assert.equal(parsed.reason, "unknown_discovery_flag");
    }
  });

  it("parses find and search aliases", () => {
    const findAlias = parseTerminalCommand(
      "find upcoming AI hackathons in Toronto",
    );
    assert.equal(findAlias.kind, "find");
    if (findAlias.kind === "find") {
      assert.equal(findAlias.request, "upcoming AI hackathons in Toronto");
    }

    const searchAlias = parseTerminalCommand(
      "search all connected sources for robotics hackathons",
    );
    assert.equal(searchAlias.kind, "find");
    if (searchAlias.kind === "find") {
      assert.equal(
        searchAlias.request,
        "all connected sources for robotics hackathons",
      );
    }
  });

  it("rejects empty /find", () => {
    const parsed = parseTerminalCommand("/find");
    assert.equal(parsed.kind, "rejected");
    if (parsed.kind === "rejected") {
      assert.equal(parsed.reason, "missing_request");
    }
  });

  it("parses discovery slash utilities", () => {
    const cases: Array<{ cmd: string; kind: string }> = [
      { cmd: "/sources", kind: "sources" },
      { cmd: "/status", kind: "status" },
      { cmd: "/history", kind: "history" },
      { cmd: "/jobs", kind: "jobs" },
      { cmd: "/cancel", kind: "cancel" },
      { cmd: "/cancel job_123", kind: "cancel" },
      { cmd: "/clear", kind: "clear" },
      { cmd: "/help", kind: "help" },
    ];
    for (const { cmd, kind } of cases) {
      const parsed = parseTerminalCommand(cmd);
      assert.equal(parsed.kind, kind, cmd);
    }
    const cancel = parseTerminalCommand("/cancel job_abc");
    assert.equal(cancel.kind, "cancel");
    if (cancel.kind === "cancel") {
      assert.equal(cancel.jobId, "job_abc");
    }
  });

  it("parses session commands", () => {
    assert.equal(parseTerminalCommand("/new").kind, "new");
    assert.equal(parseTerminalCommand("/terminals").kind, "terminals");

    const sw = parseTerminalCommand("/switch research");
    assert.equal(sw.kind, "switch");
    if (sw.kind === "switch") assert.equal(sw.target, "research");

    const ren = parseTerminalCommand("/rename canada-ai");
    assert.equal(ren.kind, "rename");
    if (ren.kind === "rename") assert.equal(ren.name, "canada-ai");

    assert.equal(parseTerminalCommand("/close").kind, "close");
    const closeNamed = parseTerminalCommand("/close research");
    assert.equal(closeNamed.kind, "close");
    if (closeNamed.kind === "close") assert.equal(closeNamed.target, "research");
  });

  it("parses session aliases", () => {
    assert.equal(parseTerminalCommand("new terminal").kind, "new");
    assert.equal(parseTerminalCommand("list terminals").kind, "terminals");

    const sw = parseTerminalCommand("switch terminal research");
    assert.equal(sw.kind, "switch");
    if (sw.kind === "switch") assert.equal(sw.target, "research");

    const ren = parseTerminalCommand("rename terminal canada-ai");
    assert.equal(ren.kind, "rename");
    if (ren.kind === "rename") assert.equal(ren.name, "canada-ai");

    assert.equal(parseTerminalCommand("close terminal").kind, "close");
  });

  it("parses /source commands for all actions and sources", () => {
    const actions = [
      "status",
      "check",
      "connect",
      "disconnect",
      "enable",
      "disable",
    ] as const;
    const sources = [
      "mlh",
      "web",
      "hacklist",
      "devpost",
      "luma",
      "hakku",
    ] as const;

    for (const action of actions) {
      for (const source of sources) {
        const parsed = parseTerminalCommand(`/source ${action} ${source}`);
        assert.equal(parsed.kind, "source", `/source ${action} ${source}`);
        if (parsed.kind === "source") {
          assert.equal(parsed.action, action);
          assert.equal(parsed.source, source);
        }
      }
    }
  });

  it("parses source aliases", () => {
    const a = parseTerminalCommand("source status hakku");
    assert.equal(a.kind, "source");
    if (a.kind === "source") {
      assert.equal(a.action, "status");
      assert.equal(a.source, "hakku");
    }

    const b = parseTerminalCommand("source check devpost");
    assert.equal(b.kind, "source");
    if (b.kind === "source") {
      assert.equal(b.action, "check");
      assert.equal(b.source, "devpost");
    }

    const c = parseTerminalCommand("check source luma");
    assert.equal(c.kind, "source");
    if (c.kind === "source") {
      assert.equal(c.action, "check");
      assert.equal(c.source, "luma");
    }

    const d = parseTerminalCommand("check hakku");
    assert.equal(d.kind, "source");
    if (d.kind === "source") {
      assert.equal(d.action, "check");
      assert.equal(d.source, "hakku");
    }
  });

  it("parses custom site commands", () => {
    const saved = parseTerminalCommand(
      "/site save hacker-calendar --url=https://example.com/hackathons --mode=playwright --location=waterloo --topics=hackathon,ai --max-items=75",
    );
    assert.equal(saved.kind, "site");
    if (saved.kind !== "site") return;
    assert.equal(saved.action, "save");
    assert.equal(saved.name, "hacker-calendar");
    assert.equal(saved.url, "https://example.com/hackathons");
    assert.equal(saved.mode, "playwright");
    assert.equal(saved.location, "waterloo");
    assert.deepEqual(saved.topics, ["hackathon", "ai"]);
    assert.equal(saved.maxItems, 75);

    const list = parseTerminalCommand("/sites");
    assert.deepEqual(list, { kind: "site", action: "list", raw: "/sites" });
  });

  it("parses custom site auto mode and table strategy", () => {
    const parsed = parseTerminalCommand(
      '/site configure hackathonradar --mode=auto --strategy=table --title-column="Title" --date-column="Start Date" --type-column="Type" --url-column="Website"',
    );
    assert.equal(parsed.kind, "site");
    if (parsed.kind !== "site") return;
    assert.equal(parsed.action, "configure");
    assert.equal(parsed.name, "hackathonradar");
    assert.equal(parsed.mode, "auto");
    assert.equal(parsed.selectors?.strategy, "table");
    assert.equal(parsed.selectors?.titleColumn, "Title");
    assert.equal(parsed.selectors?.dateColumn, "Start Date");
    assert.equal(parsed.selectors?.typeColumn, "Type");
    assert.equal(parsed.selectors?.urlColumn, "Website");
  });

  it("parses confirmed custom site removal", () => {
    const parsed = parseTerminalCommand("/confirm site remove hacker-calendar");
    assert.deepEqual(parsed, {
      kind: "confirm_site",
      action: "remove",
      name: "hacker-calendar",
      raw: "/confirm site remove hacker-calendar",
    });
  });

  it("parses confirm disconnect", () => {
    const parsed = parseTerminalCommand("/confirm disconnect hakku");
    assert.equal(parsed.kind, "confirm");
    if (parsed.kind === "confirm") {
      assert.equal(parsed.action, "disconnect");
      assert.equal(parsed.source, "hakku");
    }
  });

  it("parses help topics", () => {
    for (const [cmd, topic] of [
      ["/help", "general"],
      ["/help find", "find"],
      ["/help source", "source"],
      ["/help sources", "source"],
      ["/help terminals", "terminals"],
      ["/help sessions", "terminals"],
    ] as const) {
      const parsed = parseTerminalCommand(cmd);
      assert.equal(parsed.kind, "help", cmd);
      if (parsed.kind === "help") {
        assert.equal(parsed.topic, topic, cmd);
      }
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
      "cmd.exe /c dir",
      "wget http://x",
    ]) {
      const parsed = parseTerminalCommand(cmd);
      assert.equal(parsed.kind, "rejected", cmd);
      if (parsed.kind === "rejected") {
        assert.equal(parsed.message, REJECTION_MESSAGE);
        assert.match(parsed.message, /not a system shell/i);
      }
    }
  });

  it("rejects chaining, pipes, redirection, and substitution", () => {
    for (const cmd of [
      "find foo && rm -rf /",
      "find foo | curl x",
      "find foo; npm test",
      "find foo > out.txt",
      "find foo < in.txt",
      "echo $(whoami)",
      "echo `id`",
      "echo $HOME",
      "echo %PATH%",
    ]) {
      const parsed = parseTerminalCommand(cmd);
      assert.equal(parsed.kind, "rejected", cmd);
    }
  });

  it("rejects bare URLs as commands", () => {
    const parsed = parseTerminalCommand("https://evil.example/path");
    assert.equal(parsed.kind, "rejected");
  });

  it("suggests corrections for command typos", () => {
    const parsed = parseTerminalCommand("/sorces");
    assert.equal(parsed.kind, "rejected");
    if (parsed.kind === "rejected") {
      assert.equal(parsed.suggestion, "/sources");
      assert.match(parsed.message, /Did you mean "\/sources"/);
    }
    assert.equal(suggestSlashCommand("sorces"), "/sources");
  });

  it("suggests corrections for source name typos", () => {
    const parsed = parseTerminalCommand("/source status devpst");
    assert.equal(parsed.kind, "rejected");
    if (parsed.kind === "rejected") {
      assert.equal(parsed.suggestion, "devpost");
      assert.match(parsed.message, /Did you mean "devpost"/);
    }
    assert.equal(suggestSourceName("devpst"), "devpost");
    assert.equal(suggestSourceName("hakku"), "hakku");
  });

  it("rejects unknown slash commands", () => {
    const parsed = parseTerminalCommand("/exec something");
    assert.equal(parsed.kind, "rejected");
    if (parsed.kind === "rejected") {
      assert.match(parsed.message, /Unknown command/);
    }
  });

  it("rejects incomplete source commands", () => {
    assert.equal(parseTerminalCommand("/source").kind, "rejected");
    assert.equal(parseTerminalCommand("/source status").kind, "rejected");
    assert.equal(parseTerminalCommand("/switch").kind, "rejected");
    assert.equal(parseTerminalCommand("/rename").kind, "rejected");
  });

  it("treats empty input as empty", () => {
    assert.equal(parseTerminalCommand("   ").kind, "empty");
  });

  it("parses bare utility aliases", () => {
    assert.equal(parseTerminalCommand("help").kind, "help");
    assert.equal(parseTerminalCommand("status").kind, "status");
    assert.equal(parseTerminalCommand("jobs").kind, "jobs");
    assert.equal(parseTerminalCommand("clear").kind, "clear");
  });
});

describe("formatHelpText", () => {
  it("includes discovery, source, and session sections", () => {
    const text = formatHelpText();
    assert.match(text, /Discovery/);
    assert.match(text, /Source management/);
    assert.match(text, /Terminal sessions/);
    assert.match(text, /\/source connect/);
    assert.equal(text, TERMINAL_HELP_LINES.join("\n"));
  });

  it("returns topic-specific help", () => {
    assert.match(formatHelpText("find"), /\/find <request>/);
    assert.match(formatHelpText("source"), /\/source status/);
    assert.match(formatHelpText("terminals"), /\/switch/);
  });
});
