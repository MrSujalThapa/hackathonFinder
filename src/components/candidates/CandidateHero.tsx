import type { CandidateCard } from "@/core/candidates/types";
import { formatSourceLabel } from "@/lib/candidates/format";

export function CandidateHero({ candidate }: { candidate: CandidateCard }) {
  return (
    <div
      className="relative h-36 overflow-hidden sm:h-44"
      style={{
        background:
          "linear-gradient(145deg, var(--hero-from) 0%, #0b1220 45%, var(--hero-to) 100%)",
      }}
    >
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.35), transparent 45%), radial-gradient(circle at 80% 10%, rgba(34,197,94,0.2), transparent 40%)",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card to-transparent" />
      <div className="absolute right-4 top-4">
        <span className="rounded-full border border-white/12 bg-black/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/90">
          {formatSourceLabel(candidate.source)}
        </span>
      </div>
      <div className="absolute bottom-3 left-5 right-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">
          {candidate.status.replaceAll("_", " ")}
        </p>
      </div>
    </div>
  );
}
