import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupDom, installDom } from "@/test/dom";
import {
  needsSheetRetry,
  SheetSyncBadge,
} from "@/components/sheets/SheetSyncBadge";

describe("SheetSyncBadge", () => {
  before(async () => {
    installDom();
    const React = await import("react");
    Object.assign(globalThis, { React });
  });

  after(() => {
    cleanupDom();
  });

  it("labels pending, synced, failed, and mock states", async () => {
    const React = await import("react");
    const { render, screen } = await import("@testing-library/react");

    const { rerender } = render(
      React.createElement(SheetSyncBadge, {
        sheetRowId: null,
        sheetAppendedAt: null,
      }),
    );
    assert.ok(screen.getByText(/pending/i));

    rerender(
      React.createElement(SheetSyncBadge, {
        sheetRowId: "Hackathons!A2:X2",
        sheetAppendedAt: "2026-07-11T12:00:00.000Z",
      }),
    );
    assert.ok(screen.getByText(/synced/i));

    rerender(
      React.createElement(SheetSyncBadge, {
        sheetRowId: null,
        sheetAppendedAt: null,
        lastSyncFailed: true,
      }),
    );
    assert.ok(screen.getByText(/failed/i));

    rerender(
      React.createElement(SheetSyncBadge, {
        sheetRowId: "mock-row:abc",
        sheetAppendedAt: "2026-07-11T12:00:00.000Z",
        status: "mock_synced",
      }),
    );
    assert.ok(screen.getByText(/mock/i));
  });

  it("needsSheetRetry is true when failed or missing row", () => {
    assert.equal(
      needsSheetRetry({ sheetRowId: null, lastSyncFailed: true }),
      true,
    );
    assert.equal(needsSheetRetry({ sheetRowId: null }), true);
    assert.equal(
      needsSheetRetry({
        sheetRowId: "Hackathons!A2:X2",
        lastSyncFailed: false,
      }),
      false,
    );
  });
});
