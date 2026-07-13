import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupDom, installDom } from "@/test/dom";

describe("terminal UI components", () => {
  before(async () => {
    installDom();
    const React = await import("react");
    Object.assign(globalThis, { React });
  });

  after(() => cleanupDom());

  it("TerminalOutput renders empty state and event levels", async () => {
    const React = await import("react");
    const { render, screen, cleanup } = await import("@testing-library/react");
    const { TerminalOutput } = await import(
      "@/components/terminal/TerminalOutput"
    );

    const { rerender } = render(
      React.createElement(TerminalOutput, { lines: [] }),
    );
    assert.ok(screen.getByText(/Ready\. Type a discovery request/i));

    rerender(
      React.createElement(TerminalOutput, {
        lines: [
          {
            id: "1",
            kind: "prompt",
            text: "find AI hackathons",
          },
          {
            id: "2",
            kind: "warning",
            level: "warning",
            text: "[hakku] Authentication required",
          },
        ],
      }),
    );

    assert.ok(screen.getByText(/hackfinder> find AI hackathons/));
    assert.ok(screen.getByText(/Authentication required/));
    assert.ok(screen.getByLabelText("Discovery console output"));
    cleanup();
  });

  it("TerminalRunActions exposes queue and run-again controls", async () => {
    const React = await import("react");
    const { render, screen, cleanup, fireEvent } = await import(
      "@testing-library/react"
    );
    const { TerminalRunActions } = await import(
      "@/components/terminal/TerminalRunActions"
    );

    let again = false;
    const { container } = render(
      React.createElement(TerminalRunActions, {
        visible: true,
        jobId: "job-123",
        onRunAgain: () => {
          again = true;
        },
      }),
    );

    assert.match(container.textContent ?? "", /Open queue/);
    assert.match(container.textContent ?? "", /View run/);
    fireEvent.click(screen.getByRole("button", { name: /Run again/i }));
    assert.equal(again, true);
    cleanup();
  });
});
