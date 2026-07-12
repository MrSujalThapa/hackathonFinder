import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { cleanupDom, installDom } from "@/test/dom";
import { PREVIEW_CANDIDATE } from "@/lib/candidates/preview";
import type { CandidateCard } from "@/core/candidates/types";

const sparseCandidate: CandidateCard = {
  ...PREVIEW_CANDIDATE,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Sparse Summit",
  summary: null,
  officialUrl: null,
  applyUrl: null,
  socialUrl: null,
  startDate: null,
  endDate: null,
  deadline: null,
  location: null,
  mode: null,
  city: null,
  country: null,
  prize: null,
  themes: [],
  eligibility: null,
  whyMatch: [],
  redFlags: ["Needs official link"],
};

describe("CandidateCardView", () => {
  before(async () => {
    installDom();
    const React = await import("react");
    Object.assign(globalThis, { React });
  });

  after(() => {
    cleanupDom();
  });

  it("renders complete candidate data", async () => {
    const React = await import("react");
    const { render, screen, cleanup } = await import("@testing-library/react");
    const { CandidateCardView } = await import(
      "@/components/candidates/CandidateCard"
    );

    render(
      React.createElement(CandidateCardView, {
        candidate: PREVIEW_CANDIDATE,
        onApprove: () => undefined,
        onReject: () => undefined,
        onSave: () => undefined,
        onToggleDetails: () => undefined,
      }),
    );

    assert.ok(screen.getByText("HackTO AI Challenge"));
    assert.ok(screen.getByText(/Toronto, Canada/i));
    assert.ok(screen.getByLabelText("Approve"));
    assert.ok(screen.getByLabelText("Reject"));
    assert.ok(screen.getByLabelText("Save for later"));
    cleanup();
  });

  it("gracefully handles missing fields", async () => {
    const React = await import("react");
    const { render, screen, cleanup } = await import("@testing-library/react");
    const { CandidateCardView } = await import(
      "@/components/candidates/CandidateCard"
    );

    render(
      React.createElement(CandidateCardView, {
        candidate: sparseCandidate,
        expanded: true,
        onToggleDetails: () => undefined,
      }),
    );

    assert.ok(screen.getByText("Sparse Summit"));
    assert.ok(screen.getByText("No reliable description available"));
    assert.ok(screen.getByText("Date unclear"));
    assert.ok(screen.getAllByText(/Needs official link/i).length >= 1);
    cleanup();
  });

  it("calls approve/reject/save handlers", async () => {
    const React = await import("react");
    const { render, screen, cleanup, fireEvent } = await import(
      "@testing-library/react"
    );
    const { CandidateCardView } = await import(
      "@/components/candidates/CandidateCard"
    );

    const onApprove = mock.fn();
    const onReject = mock.fn();
    const onSave = mock.fn();

    render(
      React.createElement(CandidateCardView, {
        candidate: PREVIEW_CANDIDATE,
        onApprove,
        onReject,
        onSave,
      }),
    );

    fireEvent.click(screen.getByLabelText("Approve"));
    fireEvent.click(screen.getByLabelText("Reject"));
    fireEvent.click(screen.getByLabelText("Save for later"));

    assert.equal(onApprove.mock.callCount(), 1);
    assert.equal(onReject.mock.callCount(), 1);
    assert.equal(onSave.mock.callCount(), 1);
    cleanup();
  });
});
