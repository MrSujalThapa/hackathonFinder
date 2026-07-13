"use client";

import { useEffect, useRef } from "react";
import type { TerminalLine } from "@/lib/terminal/types";

type TerminalOutputProps = {
  lines: TerminalLine[];
  live?: boolean;
  /** Restored scroll position when switching sessions. */
  scrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
};

const PROMPT = "hackfinder>";

function lineClass(line: TerminalLine): string {
  switch (line.kind) {
    case "prompt":
      return "mac-terminal__line--prompt";
    case "success":
      return "mac-terminal__line--success";
    case "warning":
      return "mac-terminal__line--warning";
    case "error":
      return "mac-terminal__line--error";
    case "help":
    case "system":
      return "mac-terminal__line--muted";
    case "summary":
      return "mac-terminal__line--summary";
    default:
      if (line.level === "success") return "mac-terminal__line--success";
      if (line.level === "warning") return "mac-terminal__line--warning";
      if (line.level === "error") return "mac-terminal__line--error";
      return "mac-terminal__line--default";
  }
}

export function TerminalOutput({
  lines,
  live = false,
  scrollTop = 0,
  onScrollTopChange,
}: TerminalOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const initialScrollRef = useRef(scrollTop);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  onScrollTopChangeRef.current = onScrollTopChange;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = initialScrollRef.current;
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    // Stick to bottom only when the user is already near it (or first paint).
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [lines, live]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        onScrollTopChangeRef.current?.(scroller.scrollTop);
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div
      ref={scrollerRef}
      className="mac-terminal__scrollback"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Discovery console output"
      tabIndex={0}
    >
      {lines.length === 0 ? (
        <p className="mac-terminal__line mac-terminal__line--muted">
          Ready. Type a discovery request or /help.
        </p>
      ) : (
        <ul className="mac-terminal__lines">
          {lines.map((line) => (
            <li key={line.id}>
              <pre className={["mac-terminal__line", lineClass(line)].join(" ")}>
                {line.kind === "prompt" ? `${PROMPT} ${line.text}` : line.text}
              </pre>
            </li>
          ))}
        </ul>
      )}
      {live ? (
        <span className="mac-terminal__cursor" aria-hidden />
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
}
