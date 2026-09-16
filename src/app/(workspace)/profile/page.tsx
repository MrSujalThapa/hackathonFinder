import { ProfileEditor } from "@/components/applications/ProfileEditor";
import { getProfile } from "@/server/applications/repository";
export default async function ProfilePage() { const profile = await getProfile(); return <section className="mx-auto max-w-3xl space-y-5"><header><p className="font-mono text-xs text-muted">APPLICATION DATA</p><h1 className="hf-doc-title text-3xl">Profile</h1></header><ProfileEditor initialFields={profile} /></section>; }
