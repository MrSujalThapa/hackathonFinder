import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupDom, installDom } from "@/test/dom";

describe("OpenSheetLink", () => {
  before(async () => {
    installDom();
    const React = await import("react");
    Object.assign(globalThis, { React });
  });

  after(() => {
    cleanupDom();
  });

  it("renders a disabled placeholder when URL is missing", async () => {
    const previous = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
    delete process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;

    const React = await import("react");
    const { render, screen } = await import("@testing-library/react");
    const { OpenSheetLink } = await import("@/components/shell/OpenSheetLink");

    render(React.createElement(OpenSheetLink));
    const el = screen.getByText("Open Sheet");
    assert.equal(el.getAttribute("aria-disabled"), "true");
    assert.equal(el.tagName.toLowerCase(), "span");

    if (previous !== undefined) {
      process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL = previous;
    }
  });

  it("renders an external link with noopener when configured", async () => {
    const previous = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
    process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL =
      "https://docs.google.com/spreadsheets/d/abc123/edit";

    const React = await import("react");
    const { render, screen } = await import("@testing-library/react");
    // Re-import after env change — module reads env at render time.
    const { OpenSheetLink } = await import("@/components/shell/OpenSheetLink");

    render(React.createElement(OpenSheetLink));
    const link = screen.getByRole("link", { name: "Open Sheet" });
    assert.equal(
      link.getAttribute("href"),
      "https://docs.google.com/spreadsheets/d/abc123/edit",
    );
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");

    if (previous !== undefined) {
      process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL = previous;
    } else {
      delete process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
    }
  });
});
