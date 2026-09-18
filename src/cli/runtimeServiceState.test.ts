import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { markRuntimeService } from "@/cli/runtimeServiceState";

test("markRuntimeService merges the service key and preserves supervisor state", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-runtime-"));
  const statePath = join(root, ".data", "hackfinder-runtime-state.json");
  markRuntimeService("discord", "starting", undefined, root);
  markRuntimeService("discovery", "completed", undefined, root);
  markRuntimeService("discord", "running", "gateway READY", root);
  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    services: Record<string, { status: string; detail?: string }>;
  };
  assert.equal(state.services["discord"]?.status, "running");
  assert.equal(state.services["discord"]?.detail, "gateway READY");
  assert.equal(state.services["discovery"]?.status, "completed");
});
