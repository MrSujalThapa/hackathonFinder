"use client";

type CandidateActionsProps = {
  onApprove: () => void;
  onReject: () => void;
  onSave: () => void;
  disabled?: boolean;
};

export function CandidateActions({
  onApprove,
  onReject,
  onSave,
  disabled = false,
}: CandidateActionsProps) {
  return (
    <div
      className="hf-decision-bar"
      role="group"
      aria-label="Candidate actions"
    >
      <button
        type="button"
        aria-label="Reject"
        title="Reject (Left arrow)"
        disabled={disabled}
        onClick={onReject}
        className="hf-btn hf-btn-reject hf-touch"
      >
        Reject
      </button>
      <button
        type="button"
        aria-label="Save for later"
        title="Save for later (S)"
        disabled={disabled}
        onClick={onSave}
        className="hf-btn hf-btn-save hf-touch"
      >
        Save
      </button>
      <button
        type="button"
        aria-label="Approve"
        title="Approve (Right arrow)"
        disabled={disabled}
        onClick={onApprove}
        className="hf-btn hf-btn-approve hf-touch font-semibold"
      >
        Approve
      </button>
    </div>
  );
}
