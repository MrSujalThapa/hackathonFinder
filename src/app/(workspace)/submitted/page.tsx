import { ApplicationsList } from "@/components/applications/ApplicationsList";

export default function SubmittedPage() { return <section className="mx-auto max-w-3xl space-y-5"><header><p className="font-mono text-xs text-muted">APPLICATION HISTORY</p><h1 className="hf-doc-title text-3xl">Submitted</h1><p className="mt-2 text-muted">Submitted answers and confirmations are retained here even when the external form no longer exposes them.</p></header><ApplicationsList status="submitted" /></section>; }
