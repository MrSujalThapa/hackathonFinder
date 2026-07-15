"use client";

import { useEffect, useId, useRef } from "react";

type TerminalInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onHistoryPrev: () => void;
  onHistoryNext: () => void;
  onAutocomplete?: (
    value: string,
    cursor: number,
  ) => { value: string; cursor: number } | null;
  disabled?: boolean;
  busy?: boolean;
};

export function TerminalInput({
  value,
  onChange,
  onSubmit,
  onHistoryPrev,
  onHistoryNext,
  onAutocomplete,
  disabled = false,
  busy = false,
}: TerminalInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const labelId = useId();

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [value]);

  return (
    <div className="mac-terminal__prompt-bar">
      <label id={labelId} className="sr-only">
        Discovery command
      </label>
      <div className="mac-terminal__prompt-row">
        <span className="mac-terminal__prompt" aria-hidden>
          hackfinder&gt;
        </span>
        <textarea
          ref={textareaRef}
          id="discovery-terminal-input"
          aria-labelledby={labelId}
          aria-busy={busy || undefined}
          rows={1}
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          placeholder="find upcoming AI hackathons in Toronto…"
          className="mac-terminal__input hf-focus"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!disabled && !busy) onSubmit();
              return;
            }
            if (e.key === "ArrowUp" && !e.shiftKey) {
              const el = textareaRef.current;
              if (el && el.selectionStart === 0 && el.selectionEnd === 0) {
                e.preventDefault();
                onHistoryPrev();
              }
              return;
            }
            if (e.key === "ArrowDown" && !e.shiftKey) {
              const el = textareaRef.current;
              if (
                el &&
                el.selectionStart === el.value.length &&
                el.selectionEnd === el.value.length
              ) {
                e.preventDefault();
                onHistoryNext();
              }
            }
            if (e.key === "Tab" && onAutocomplete) {
              const el = textareaRef.current;
              if (!el) return;
              const next = onAutocomplete(el.value, el.selectionStart);
              if (!next) return;
              e.preventDefault();
              onChange(next.value);
              requestAnimationFrame(() => {
                textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
              });
            }
          }}
        />
        <button
          type="button"
          className="mac-terminal__run hf-focus hf-touch"
          disabled={disabled || busy || !value.trim()}
          onClick={() => onSubmit()}
          aria-label={busy ? "Starting run" : "Run command"}
        >
          {busy ? "…" : "↵"}
        </button>
      </div>
      <p className="mac-terminal__hint">Enter run · Shift+Enter newline · /help</p>
    </div>
  );
}
