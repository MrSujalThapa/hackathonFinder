import { isMockCandidatesEnabled } from "@/server/candidates/service";

export function MockModeBanner() {
  let enabled = false;
  try {
    enabled = isMockCandidatesEnabled();
  } catch {
    enabled = false;
  }

  if (!enabled) return null;

  return (
    <div
      className="border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-center text-xs text-amber-100"
      role="status"
    >
      Development mock candidates active (`USE_MOCK_CANDIDATES=true`). Data is
      in-memory and not persisted to Supabase.
    </div>
  );
}
