"use client";

import { useMemo, useState } from "react";
import type { CandidateAction } from "@/core/candidates/types";
import {
  buildActionHistory,
  formatTechnicalRefreshSummary,
} from "@/lib/candidates/actionHistory";
import { useExpandMotion } from "@/lib/ui/useExpandMotion";

const DEFAULT_LIMIT = 20;

export function CandidateActionHistory({
  actions,
}: {
  actions: CandidateAction[];
}) {
  const [showTechnical, setShowTechnical] = useState(false);
  const [showAllMeaningful, setShowAllMeaningful] = useState(false);
  const expandRef = useExpandMotion(showTechnical);

  const history = useMemo(
    () =>
      buildActionHistory(actions, {
        meaningfulLimit: showAllMeaningful ? 500 : DEFAULT_LIMIT,
      }),
    [actions, showAllMeaningful],
  );

  if (actions.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="hf-section-label">Activity</h2>
      <ul className="space-y-3">
        {history.visible.map((bucket) => {
          if (bucket.kind === "action") {
            const action = bucket.action;
            return (
              <li
                key={action.id}
                className="border-l border-border pl-3 text-sm text-foreground/80"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-foreground">
                    {formatActionLabel(action.action)}
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(action.createdAt).toLocaleString()}
                  </span>
                </div>
                {action.previousStatus &&
                action.newStatus &&
                action.previousStatus !== action.newStatus ? (
                  <p className="mt-1 text-xs text-muted">
                    {action.previousStatus} → {action.newStatus}
                  </p>
                ) : null}
              </li>
            );
          }

          return (
            <li key="technical-summary" className="hf-panel px-3 py-2.5 text-sm text-foreground/75">
              <p>{formatTechnicalRefreshSummary(bucket.count, bucket.lastAt)}</p>
              <button
                type="button"
                className="hf-link-quiet mt-2"
                aria-expanded={showTechnical}
                onClick={() => setShowTechnical((value) => !value)}
              >
                {showTechnical
                  ? "Hide technical history"
                  : "View technical history"}
              </button>
              <div
                ref={expandRef}
                className="hf-expand"
                aria-hidden={!showTechnical}
                inert={!showTechnical || undefined}
              >
                <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto border-t border-border/60 pt-2">
                  {bucket.actions.slice(0, 50).map((action) => (
                    <li key={action.id} className="text-xs text-muted">
                      <span className="font-medium text-foreground/80">
                        {action.action}
                      </span>{" "}
                      · {new Date(action.createdAt).toLocaleString()}
                      {action.previousStatus && action.newStatus
                        ? ` · ${action.previousStatus} → ${action.newStatus}`
                        : ""}
                    </li>
                  ))}
                  {bucket.actions.length > 50 ? (
                    <li className="text-xs text-muted">
                      … {bucket.actions.length - 50} more
                    </li>
                  ) : null}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
      {history.truncatedMeaningful > 0 && !showAllMeaningful ? (
        <button
          type="button"
          className="hf-link-quiet"
          onClick={() => setShowAllMeaningful(true)}
        >
          Show {history.truncatedMeaningful} older events
        </button>
      ) : null}
    </section>
  );
}

function formatActionLabel(action: string): string {
  switch (action) {
    case "SAVE_FOR_LATER":
      return "Saved";
    case "SHEET_APPEND":
      return "Sheet append";
    case "SHEET_DELETE":
      return "Sheet delete";
    default:
      return action
        .split("_")
        .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
        .join(" ");
  }
}
