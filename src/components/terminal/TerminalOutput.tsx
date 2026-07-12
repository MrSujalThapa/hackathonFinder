"use client";

import { useEffect, useRef } from "react";
import type { TerminalLine } from "@/lib/terminal/types";

type TerminalOutputProps = {
  lines: TerminalLine[];
  live?: boolean;
};

function lineClass(line: TerminalLine): string {
  switch (line.kind) {
    case "prompt":
      return "text-[color-mix(in_oklab,var(--accent-save)_88%,white)]";
    case "success":
      return "text-[color-mix(in_oklab,var(--accent-approve)_92%,white)]";
    case "warning":
      return "text-[color-mix(in_oklab,var(--accent-warn)_92%,white)]";
    case "error":
      return "text-[color-mix(in_oklab,var(--accent-danger)_92%,white)]";
    case "help":
    case "system":
      return "text-muted";
    case "summary":
      return "text-foreground/90";
    default:
      if (line.level === "success") {
        return "text-[color-mix(in_oklab,var(--accent-approve)_92%,white)]";
      }
      if (line.level === "warning") {
        return "text-[color-mix(in_oklab,var(--accent-warn)_92%,white)]";
      }
      if (line.level === "error") {
        return "text-[color-mix(in_oklab,var(--accent-danger)_92%,white)]";
      }
      return "text-foreground/85";
  }
}

export function TerminalOutput({ lines, live = false }: TerminalOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    if (nearBottom || live) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [lines, live]);

  return (
    <div
      ref={scrollerRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Discovery console output"
      tabIndex={0}
    >
      {lines.length === 0 ? (
        <p className="font-mono text-sm text-muted">
          Ready. Type a discovery request or /help.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lines.map((line) => (
            <li key={line.id}>
              <pre
                className={[
                  "whitespace-pre-wrap break-words font-mono text-sm leading-relaxed",
                  lineClass(line),
                ].join(" ")}
              >
                {line.kind === "prompt" ? `$ ${line.text}` : line.text}
              </pre>
            </li>
          ))}
        </ul>
      )}
      {live ? (
        <span
          className="mt-2 inline-block h-4 w-2 animate-pulse bg-[color-mix(in_oklab,var(--accent-save)_80%,transparent)]"
          aria-hidden
        />
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
}
