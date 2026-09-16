"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ApplicationDraft } from "@/core/applications/types";

export function ApplicationsList({ status }: { status?: ApplicationDraft["status"] }) {
  const [applications, setApplications] = useState<ApplicationDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch("/api/applications").then(async (response) => { const body = await response.json() as { data?: { applications?: ApplicationDraft[] } }; if (!response.ok) throw new Error("Could not load applications."); setApplications(body.data?.applications ?? []); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load applications.")); }, []);
  if (error) return <p role="alert" className="text-accent-danger">{error}</p>;
  if (!applications) return <p aria-busy="true" className="text-muted">Loading applications…</p>;
  const visible = status ? applications.filter((application) => application.status === status) : applications;
  if (!visible.length) return <div className="hf-sheet-frame p-6"><h2 className="hf-doc-title text-xl">No {status === "submitted" ? "submitted applications" : "application drafts"}</h2><p className="mt-2 text-muted">{status === "submitted" ? "Submitted snapshots will appear here." : "Prepare an application from an opportunity when you have its form URL."}</p></div>;
  return <ul className="space-y-3" aria-label="Applications">{visible.map((application) => <li key={application.id} className="hf-sheet-frame p-4"><Link className="hf-focus block" href={`/drafts/${application.id}`}><div className="flex items-center justify-between gap-3"><span className="font-medium">Application draft</span><span className="font-mono text-xs text-muted">{application.status.replaceAll("_", " ")}</span></div><p className="mt-2 text-sm text-muted">{application.questions.filter((question) => question.answer).length}/{application.questions.length} fields answered{application.currentPage ? ` · Page ${application.currentPage}${application.totalPages ? `/${application.totalPages}` : ""}` : ""}</p></Link></li>)}</ul>;
}
