import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupDom, installDom } from "@/test/dom";

describe("queue empty and error states", () => {
  before(async () => {
    installDom();
    const React = await import("react");
    Object.assign(globalThis, { React });
  });

  after(() => cleanupDom());

  it("renders empty queue messaging", async () => {
    const React = await import("react");
    const { render, screen, cleanup } = await import("@testing-library/react");
    const { EmptyState } = await import("@/components/ui/EmptyState");

    render(
      React.createElement(EmptyState, {
        title: "No new hackathons to review",
        description: "Run the agent to discover more.",
      }),
    );

    assert.ok(screen.getByText("No new hackathons to review"));
    cleanup();
  });

  it("renders API error state with retry", async () => {
    const React = await import("react");
    const { render, screen, cleanup, fireEvent } = await import(
      "@testing-library/react"
    );
    const { ErrorState } = await import("@/components/ui/ErrorState");
    let retried = false;

    render(
      React.createElement(ErrorState, {
        message: "fetch failed",
        onRetry: () => {
          retried = true;
        },
      }),
    );

    assert.ok(screen.getByRole("alert"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    assert.equal(retried, true);
    cleanup();
  });
});
