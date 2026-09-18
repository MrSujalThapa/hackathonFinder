import { AppShell } from "@/components/shell/AppShell";

// Workspace routes render private, live owner data from Supabase. Rendering them
// dynamically keeps data access at request time instead of attempting a
// network-backed static export during the production build.
export const dynamic = "force-dynamic";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
