"use client";

import { useEffect, useId, useRef } from "react";

type TerminalInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onHistoryPrev: () => void;
  onHistoryNext: () => void;
  disabled?: boolean;
  busy?: boolean;
};

export function TerminalInput({
  value,
  onChange,
  onSubmit,
  onHistoryPrev,
  onHistoryNext,
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
    <div className="border-t border-[color-mix(in_oklab,var(--ink-line)_70%,transparent)] bg-inset/80 px-3 py-3 sm:px-4">
      <label id={labelId} className="sr-only">
        Discovery command
      </label>
      <div className="flex items-end gap-2">
        <span
          className="mb-2.5 shrink-0 font-mono text-sm text-[color-mix(in_oklab,var(--accent-save)_90%,white)]"
          aria-hidden
        >
          $
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
          className="hf-focus min-h-[44px] max-h-36 w-full resize-none bg-transparent py-2.5 font-mono text-sm leading-relaxed text-foreground placeholder:text-muted/70 disabled:opacity-50"
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
          }}
        />
        <button
          type="button"
          className="hf-focus hf-touch mb-0.5 min-h-[44px] min-w-[44px] shrink-0 border border-border px-3 font-mono text-xs uppercase tracking-[0.08em] text-muted transition-colors hover:border-[color-mix(in_oklab,var(--accent-save)_45%,transparent)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || busy || !value.trim()}
          onClick={() => onSubmit()}
          aria-label={busy ? "Starting run" : "Run command"}
        >
          {busy ? "…" : "Run"}
        </button>
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-muted/80">
        Enter run · Shift+Enter newline · /help
      </p>
    </div>
  );
}
