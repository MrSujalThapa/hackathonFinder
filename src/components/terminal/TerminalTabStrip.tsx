"use client";

type TabSession = {
  id: string;
  title: string;
  /** Show a live indicator when a job is attached. */
  busy?: boolean;
};

type TerminalTabStripProps = {
  sessions: TabSession[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose?: (id: string) => void;
};

/**
 * Desktop tab strip + mobile compact session switcher for the discovery console.
 */
export function TerminalTabStrip({
  sessions,
  activeId,
  onSelect,
  onNew,
  onClose,
}: TerminalTabStripProps) {
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  return (
    <div className="mac-terminal__tabs">
      {/* Desktop / tablet tabs */}
      <div
        className="mac-terminal__tablist"
        role="tablist"
        aria-label="Terminal sessions"
      >
        {sessions.map((session) => {
          const selected = session.id === activeId;
          return (
            <div
              key={session.id}
              className={[
                "mac-terminal__tab",
                selected ? "mac-terminal__tab--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="presentation"
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                id={`term-tab-${session.id}`}
                className="mac-terminal__tab-btn hf-focus"
                title={session.title}
                onClick={() => onSelect(session.id)}
              >
                {session.busy ? (
                  <span className="mac-terminal__tab-live" aria-hidden />
                ) : null}
                <span className="mac-terminal__tab-label">{session.title}</span>
              </button>
              {onClose && sessions.length > 0 ? (
                <button
                  type="button"
                  className="mac-terminal__tab-close hf-focus"
                  aria-label={`Close ${session.title}`}
                  title="Close session (job keeps running)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(session.id);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className="mac-terminal__tab-new hf-focus hf-touch"
          onClick={onNew}
          aria-label="New terminal session"
        >
          New
        </button>
      </div>

      {/* Mobile compact switcher */}
      <div className="mac-terminal__tab-mobile">
        <label className="sr-only" htmlFor="term-session-switch">
          Switch terminal session
        </label>
        <select
          id="term-session-switch"
          className="mac-terminal__tab-select hf-focus"
          value={active?.id ?? ""}
          onChange={(e) => onSelect(e.target.value)}
        >
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.busy ? "● " : ""}
              {session.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="mac-terminal__tab-new mac-terminal__tab-new--mobile hf-focus hf-touch"
          onClick={onNew}
        >
          New
        </button>
      </div>
    </div>
  );
}
