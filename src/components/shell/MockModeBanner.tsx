import { isDemoMode } from "@/config/env";
import { isMockCandidatesEnabled } from "@/server/candidates/service";

export function MockModeBanner() {
  let mockEnabled = false;
  let demoEnabled = false;
  try {
    mockEnabled = isMockCandidatesEnabled();
    demoEnabled = isDemoMode();
  } catch {
    mockEnabled = false;
    demoEnabled = false;
  }

  if (!mockEnabled) return null;

  return (
    <div
      className="border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-center text-xs text-amber-100"
      role="status"
    >
      {demoEnabled ? (
        <>
          Demo mode active (`DEMO_MODE=true`). Showing deterministic fixture
          candidates — not live Supabase data. Sheets sync is simulated; discovery
          dry-runs do not persist.
        </>
      ) : (
        <>
          Development mock candidates active (`USE_MOCK_CANDIDATES=true`). Data is
          in-memory and not persisted to Supabase.
        </>
      )}
    </div>
  );
}
