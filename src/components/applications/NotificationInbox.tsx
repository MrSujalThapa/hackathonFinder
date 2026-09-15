"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { InAppNotification } from "@/server/notifications/service";
export function NotificationInbox() {
  const [items, setItems] = useState<InAppNotification[] | null>(null);
  useEffect(() => { fetch("/api/notifications").then((response) => response.json()).then((body: { data?: { notifications?: InAppNotification[] } }) => setItems(body.data?.notifications ?? [])).catch(() => setItems([])); }, []);
  if (!items) return <p aria-busy="true" className="text-muted">Loading notifications…</p>;
  if (!items.length) return <div className="hf-sheet-frame p-6"><h2 className="hf-doc-title text-xl">No notifications</h2><p className="mt-2 text-muted">Application openings, deadlines, and review requests will appear here.</p></div>;
  return <ul className="space-y-3">{items.map((item) => <li key={item.id} className="hf-sheet-frame p-4"><p className="font-mono text-xs text-muted">{item.type.replaceAll("_", " ")} · {new Date(item.sentAt).toLocaleString()}</p><h2 className="mt-2 font-medium">{item.title}</h2><p className="mt-1 text-sm text-muted">{item.body}</p>{item.actionUrl ? <Link className="hf-focus mt-3 inline-block text-sm underline" href={item.actionUrl}>Open</Link> : null}</li>)}</ul>;
}
