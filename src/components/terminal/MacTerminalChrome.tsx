import type { ReactNode } from "react";

type MacTerminalChromeProps = {
  /** Centered title-bar label, e.g. "hackfinder — console — 120×40". */
  title?: string;
  /** Optional trailing status (idle / running · job id). */
  status?: string | null;
  children: ReactNode;
  className?: string;
};

/**
 * Decorative macOS Terminal-style window frame.
 * Traffic lights are non-interactive (aria-hidden).
 */
export function MacTerminalChrome({
  title = "hackfinder — console — 120×40",
  status = null,
  children,
  className = "",
}: MacTerminalChromeProps) {
  return (
    <div
      className={["mac-terminal", className].filter(Boolean).join(" ")}
      role="region"
      aria-label="Discovery console"
    >
      <div className="mac-terminal__titlebar">
        <div className="mac-terminal__lights" aria-hidden="true">
          <span className="mac-terminal__light mac-terminal__light--close" />
          <span className="mac-terminal__light mac-terminal__light--minimize" />
          <span className="mac-terminal__light mac-terminal__light--zoom" />
        </div>
        <p className="mac-terminal__title">{title}</p>
        {status ? (
          <span className="mac-terminal__status" title={status}>
            {status}
          </span>
        ) : null}
      </div>
      <div className="mac-terminal__body">{children}</div>
    </div>
  );
}
