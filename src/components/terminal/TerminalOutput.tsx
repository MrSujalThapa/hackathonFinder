"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalLine } from "@/lib/terminal/types";

type TerminalOutputProps = {
  lines: TerminalLine[];
  live?: boolean;
  /** Restored scroll position when switching sessions. */
  scrollTop?: number;
  scrollToBottomSignal?: number;
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
  scrollToBottomSignal = 0,
  onScrollTopChange,
}: TerminalOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const initialScrollRef = useRef(scrollTop);
  const nearBottomRef = useRef(true);
  const previousLineCountRef = useRef(lines.length);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  const [showJump, setShowJump] = useState(false);
  onScrollTopChangeRef.current = onScrollTopChange;

  const scrollToBottom = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    nearBottomRef.current = true;
    setShowJump(false);
    onScrollTopChangeRef.current?.(scroller.scrollTop);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = initialScrollRef.current;
    nearBottomRef.current =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 80;
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const lineCountChanged = previousLineCountRef.current !== lines.length;
    previousLineCountRef.current = lines.length;
    if (!lineCountChanged) return;
    if (nearBottomRef.current) {
      scrollToBottom();
    } else {
      setShowJump(true);
    }
  }, [lines.length, live, scrollToBottom]);

  useEffect(() => {
    if (scrollToBottomSignal === 0) return;
    scrollToBottom();
  }, [scrollToBottom, scrollToBottomSignal]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        nearBottomRef.current =
          scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 80;
        if (nearBottomRef.current) setShowJump(false);
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
      {showJump ? (
        <button
          type="button"
          className="mac-terminal__jump hf-focus"
          onClick={scrollToBottom}
        >
          Jump to latest
        </button>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
}
