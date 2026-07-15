import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  confirmTerminalSourceDisconnect,
  connectTerminalSource,
  getTerminalSourceStatus,
  requestTerminalSourceDisconnect,
  setTerminalSourceConnectionHooksForTests,
} from "@/server/sources/terminalConnection";

let tmpRoot: string | null = null;

function useTempProfiles(): string {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "hf-terminal-source-"));
  process.env.BROWSER_PROFILE_ROOT = tmpRoot;
  process.env.HAKKU_PROFILE_NAME = "hakku-test";
  return tmpRoot;
}

afterEach(() => {
  setTerminalSourceConnectionHooksForTests(null);
  delete process.env.BROWSER_PROFILE_ROOT;
  delete process.env.HAKKU_PROFILE_NAME;
  delete process.env.TERMINAL_SOURCE_MOCK_HAKKU;
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  }
});

describe("terminal source connection commands", () => {
  it("reports Hakku status without leaking profile paths", async () => {
    const root = useTempProfiles();

    const result = await getTerminalSourceStatus("hakku", {
      sessionId: "term-a",
    });
    const text = result.lines.map((line) => line.text).join("\n");

    assert.match(text, /Status: Not connected/);
    assert.match(text, /Browser required: yes/);
    assert.doesNotMatch(text, new RegExp(root.replace(/\\/g, "\\\\")));
    assert.doesNotMatch(text, /cookie|storage|credential|authorization/i);
  });

  it("keeps Luma in public mode for connect", async () => {
    const result = await connectTerminalSource("luma", {
      sessionId: "term-a",
    });
    const text = result.lines.map((line) => line.text).join("\n");

    assert.match(text, /Public mode is available/);
    assert.match(text, /not implemented/);
  });

  it("scopes disconnect confirmation to one terminal and expires it", async () => {
    await requestTerminalSourceDisconnect("luma", {
      sessionId: "term-a",
      now: new Date("2026-07-13T00:00:00.000Z"),
    });

    const other = await confirmTerminalSourceDisconnect("luma", {
      sessionId: "term-b",
      now: new Date("2026-07-13T00:00:01.000Z"),
    });
    assert.match(other.lines[0]?.text ?? "", /expired/i);

    const expired = await confirmTerminalSourceDisconnect("luma", {
      sessionId: "term-a",
      now: new Date("2026-07-13T00:03:00.000Z"),
    });
    assert.match(expired.lines[0]?.text ?? "", /expired/i);
  });

  it("allows mocked Hakku connect without launching a browser", async () => {
    setTerminalSourceConnectionHooksForTests({
      connectHakku: async () => ({
        lines: [
          { level: "info", text: "[hakku] Opening persistent browser session..." },
          { level: "success", text: "[hakku] Connected." },
        ],
      }),
    });

    const result = await connectTerminalSource("hakku", {
      sessionId: "term-a",
    });

    assert.deepEqual(
      result.lines.map((line) => line.text),
      [
        "[hakku] Opening persistent browser session...",
        "[hakku] Connected.",
      ],
    );
  });

  it("allows development env mocked Hakku connect for browser QA", async () => {
    process.env.TERMINAL_SOURCE_MOCK_HAKKU = "true";

    const result = await connectTerminalSource("hakku", {
      sessionId: "term-a",
    });
    const text = result.lines.map((line) => line.text).join("\n");

    assert.match(text, /Opening persistent browser session/);
    assert.match(text, /Authentication detected/);
    assert.match(text, /Connected/);
  });
});
