"use client";
import { useEffect, useState } from "react";
const defaultFields = ["name", "email", "phone", "school", "program", "graduationYear", "cityCountry", "github", "linkedin", "portfolio", "bio"];
export function ProfileEditor() {
  const [fields, setFields] = useState<Record<string, string>>({}); const [message, setMessage] = useState("");
  useEffect(() => { fetch("/api/profile").then((r) => r.json()).then((body: { data?: { profile?: Record<string, string> } }) => setFields(body.data?.profile ?? {})); }, []);
  const names = [...new Set([...defaultFields, ...Object.keys(fields)])];
  async function save() { setMessage("Saving…"); const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) }); setMessage(response.ok ? "Profile saved." : "Could not save profile."); }
  return <form className="hf-sheet-frame space-y-4 p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}><p className="text-sm text-muted">Factual data only—this is never sent to a model just to populate matching fields.</p>{names.map((name) => <label key={name} className="block text-sm"><span className="mb-1 block capitalize">{name.replace(/([A-Z])/g, " $1")}</span><input className="hf-focus w-full border border-border bg-inset px-3 py-2" value={fields[name] ?? ""} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} /></label>)}<button className="hf-focus border border-accent-save px-4 py-2 text-sm" type="submit">Save profile</button><p role="status" className="text-sm text-muted">{message}</p></form>;
}
