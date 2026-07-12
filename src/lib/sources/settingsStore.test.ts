import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  readSourceSettings,
  updateSourceEnabled,
  writeSourceSettings,
} from "@/lib/sources/settingsStore";
import { DEFAULT_SOURCE_ENABLED, resolveSourceEnabled } from "@/lib/sources/config";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("source settings store", () => {
  it("defaults enabled map when file missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "source-settings-"));
    tempDirs.push(dir);
    const state = readSourceSettings(dir, {});
    assert.deepEqual(state.enabled, DEFAULT_SOURCE_ENABLED);
  });

  it("persists enable toggles", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "source-settings-"));
    tempDirs.push(dir);
    writeSourceSettings(
      {
        enabled: { ...DEFAULT_SOURCE_ENABLED, hakku: false },
        lastSuccessfulAt: {},
        lastHealth: {},
      },
      dir,
    );
    const updated = updateSourceEnabled({ luma: false }, dir, {});
    assert.equal(updated.enabled.hakku, false);
    assert.equal(updated.enabled.luma, false);
    assert.equal(updated.enabled.mlh, true);
  });
});

describe("resolveSourceEnabled", () => {
  it("honors env overrides", () => {
    assert.equal(
      resolveSourceEnabled("mlh", undefined, { SOURCE_MLH_ENABLED: "false" }),
      false,
    );
    assert.equal(
      resolveSourceEnabled("web", undefined, { SOURCE_WEB_ENABLED: "1" }),
      true,
    );
    assert.equal(resolveSourceEnabled("devpost", true, { SOURCE_DEVPOST_ENABLED: "false" }), true);
  });
});
