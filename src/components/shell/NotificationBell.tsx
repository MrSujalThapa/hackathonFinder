"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export function NotificationBell() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { const controller = new AbortController(); fetch("/api/notifications", { signal: controller.signal }).then((response) => response.json()).then((body: { data?: { notifications?: unknown[] } }) => setCount(body.data?.notifications?.length ?? 0)).catch(() => setCount(0)); return () => controller.abort(); }, []);
  return <Link href="/notifications" className="hf-focus relative inline-flex h-10 w-10 items-center justify-center border border-border text-muted hover:text-foreground" aria-label={`${count ?? 0} notifications`}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" strokeLinecap="round" strokeLinejoin="round" /></svg>{count && count > 0 ? <span className="absolute -right-1 -top-1 min-w-4 bg-accent-save px-1 text-center font-mono text-[10px] leading-4 text-background">{count > 99 ? "99+" : count}</span> : null}</Link>;
}
