"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { CandidateCard } from "@/core/candidates/types";
import { CandidateCardView } from "@/components/candidates/CandidateCard";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { QueueDecision } from "@/hooks/useCandidateQueue";
import { getCandidateActions } from "@/lib/candidates/actionPolicy";
import { startMark } from "@/lib/perf/timing";

gsap.registerPlugin(useGSAP);

const SWIPE_THRESHOLD = 110;
const AXIS_LOCK_PX = 12;
const TAP_SLOP_PX = 10;

type SwipeDeckProps = {
  candidate: CandidateCard;
  upcoming?: CandidateCard | null;
  /** When true, blocks interaction on the *current* card only. */
  busy?: boolean;
  onDecision: (
    action: QueueDecision,
    candidateId?: string,
  ) => Promise<{ ok: boolean }>;
};

export function SwipeDeck({
  candidate,
  upcoming = null,
  busy = false,
  onDecision,
}: SwipeDeckProps) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDetailsElement>(null);
  const drag = useRef({
    active: false,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    axis: null as null | "x" | "y",
    moved: false,
  });
  const [overlay, setOverlay] = useState<"approve" | "reject" | null>(null);
  const [ready, setReady] = useState(false);
  const exitingRef = useRef(false);
  const lockedCandidateIdRef = useRef<string | null>(null);

  const queueActions = getCandidateActions(candidate).filter(
    (action) =>
      action.apiAction === "approve" ||
      action.apiAction === "reject" ||
      action.apiAction === "save",
  );

  useEffect(() => {
    setReady(true);
  }, []);

  useGSAP(
    () => {
      const el = cardRef.current;
      if (!el || !ready || reducedMotion) return;
      gsap.fromTo(
        el,
        { y: 12, scale: 0.98 },
        { y: 0, scale: 1, duration: 0.2, ease: "power2.out" },
      );
    },
    { dependencies: [candidate.id, ready, reducedMotion] },
  );

  useEffect(() => {
    setOverlay(null);
    exitingRef.current = false;
    lockedCandidateIdRef.current = null;
    if (actionsRef.current) actionsRef.current.open = false;
    if (cardRef.current) {
      gsap.set(cardRef.current, { x: 0, y: 0, rotation: 0, clearProps: "transform" });
    }
  }, [candidate.id]);

  const isCurrentLocked = () =>
    exitingRef.current ||
    busy ||
    lockedCandidateIdRef.current === candidate.id;

  const openDetails = useCallback(() => {
    if (
      exitingRef.current ||
      busy ||
      lockedCandidateIdRef.current === candidate.id
    ) {
      return;
    }
    router.push(`/candidate/${candidate.id}`);
  }, [busy, candidate.id, router]);

  const exitAndDecide = useCallback(
    async (action: QueueDecision) => {
      if (exitingRef.current || busy) return;
      exitingRef.current = true;
      lockedCandidateIdRef.current = candidate.id;
      if (actionsRef.current) actionsRef.current.open = false;
      setOverlay(
        action === "approve" ? "approve" : action === "reject" ? "reject" : null,
      );

      const el = cardRef.current;
      const duration = reducedMotion ? 0.01 : 0.2;
      if (el) {
        const x =
          action === "approve"
            ? window.innerWidth
            : action === "reject"
              ? -window.innerWidth
              : 0;
        const y = action === "save" ? -window.innerHeight * 0.28 : 0;
        const rotation =
          action === "approve" ? 14 : action === "reject" ? -14 : 0;
        await gsap.to(el, {
          x,
          y,
          rotation,
          opacity: 0,
          duration,
          ease: "power2.in",
        });
      }

      const endTransition = startMark("queue.transition");
      // Parent removes optimistically and does not await Sheets — next card
      // unlocks when candidate.id changes.
      const result = await onDecision(action, candidate.id);
      endTransition();
      if (!result.ok && el) {
        gsap.set(el, { x: 0, y: 0, rotation: 0, opacity: 1 });
        exitingRef.current = false;
        lockedCandidateIdRef.current = null;
        setOverlay(null);
      }
    },
    [busy, candidate.id, onDecision, reducedMotion],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isCurrentLocked()) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "button, a, input, textarea, select, summary, [role='button']",
      )
    ) {
      return;
    }
    drag.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      x: 0,
      y: 0,
      axis: null,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active || !cardRef.current) return;
    const x = event.clientX - drag.current.startX;
    const y = event.clientY - drag.current.startY;
    drag.current.x = x;
    drag.current.y = y;

    if (!drag.current.axis) {
      const absX = Math.abs(x);
      const absY = Math.abs(y);
      if (absX < AXIS_LOCK_PX && absY < AXIS_LOCK_PX) return;
      drag.current.axis = absX >= absY ? "x" : "y";
    }

    if (drag.current.axis === "y") {
      // Vertical intent: release swipe so page can scroll; do not open details later.
      drag.current.moved = true;
      drag.current.active = false;
      setOverlay(null);
      cardRef.current.style.touchAction = "pan-y";
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      return;
    }

    // Horizontal swipe: block scroll and drive the card.
    drag.current.moved = true;
    cardRef.current.style.touchAction = "none";
    event.preventDefault();
    const rotation = reducedMotion ? 0 : gsap.utils.clamp(-15, 15, x * 0.06);
    gsap.set(cardRef.current, { x, y: 0, rotation });

    if (x > SWIPE_THRESHOLD * 0.55) setOverlay("approve");
    else if (x < -SWIPE_THRESHOLD * 0.55) setOverlay("reject");
    else setOverlay(null);
  };

  const onPointerUp = () => {
    if (!drag.current.active && !drag.current.moved) return;
    const { x, axis, moved, active } = drag.current;
    drag.current.active = false;
    if (cardRef.current) cardRef.current.style.touchAction = "pan-y";

    if (active && axis === "x") {
      if (x > SWIPE_THRESHOLD) {
        void exitAndDecide("approve");
        return;
      }
      if (x < -SWIPE_THRESHOLD) {
        void exitAndDecide("reject");
        return;
      }
    }

    setOverlay(null);
    if (cardRef.current && moved && axis === "x") {
      gsap.to(cardRef.current, {
        x: 0,
        y: 0,
        rotation: 0,
        duration: reducedMotion ? 0.01 : 0.18,
        ease: "power2.out",
      });
    }

    // Body tap (no meaningful drag) opens details; never after a swipe.
    if (
      active &&
      !moved &&
      Math.abs(drag.current.x) <= TAP_SLOP_PX &&
      Math.abs(drag.current.y) <= TAP_SLOP_PX
    ) {
      openDetails();
    }
  };

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const onTouchMove = (event: TouchEvent) => {
      if (!drag.current.active || drag.current.axis !== "x") return;
      event.preventDefault();
    };

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, [candidate.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (exitingRef.current || busy) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void exitAndDecide("reject");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void exitAndDecide("approve");
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        void exitAndDecide("save");
      } else if (event.key === "Enter") {
        event.preventDefault();
        openDetails();
      } else if (event.key === "Escape") {
        if (actionsRef.current?.open) {
          event.preventDefault();
          actionsRef.current.open = false;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, exitAndDecide, openDetails]);

  const cardBusy = busy || exitingRef.current;

  return (
    <div className="relative mx-auto w-full max-w-[var(--content-queue)]">
      {upcoming ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 scale-[0.97] opacity-35"
        >
          <div className="origin-top">
            <CandidateCardView candidate={upcoming} busy />
          </div>
        </div>
      ) : null}

      <div
        ref={cardRef}
        className="relative z-10"
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {overlay ? (
          <div
            className={[
              "pointer-events-none absolute left-1/2 top-8 z-10 -translate-x-1/2 rounded-[var(--radius-md)] border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]",
              overlay === "approve"
                ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                : "border-slate-300/40 bg-slate-500/20 text-slate-100",
            ].join(" ")}
          >
            {overlay}
          </div>
        ) : null}

        <CandidateCardView
          candidate={candidate}
          onToggleDetails={openDetails}
          busy={cardBusy}
        />
      </div>

      {queueActions.length > 0 ? (
        <div className="mt-3 flex justify-end">
          <details ref={actionsRef} className="relative">
            <summary
              className="hf-btn hf-btn-ghost hf-touch hf-focus cursor-pointer list-none px-3 text-sm text-muted"
              aria-label="More actions"
            >
              <span aria-hidden>⋯</span>
            </summary>
            <div
              className="absolute right-0 z-20 mt-2 min-w-[10.5rem] rounded-[var(--radius-lg)] border border-border bg-elevated py-1 shadow-[var(--shadow-soft)]"
              role="menu"
              aria-label="Candidate actions"
            >
              {queueActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  disabled={cardBusy}
                  className="hf-focus block w-full px-3 py-2.5 text-left text-sm text-foreground hover:bg-inset disabled:opacity-50"
                  onClick={() => {
                    if (actionsRef.current) actionsRef.current.open = false;
                    void exitAndDecide(action.apiAction as QueueDecision);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

/** Exported for unit tests */
export const SWIPE_THRESHOLDS = {
  horizontal: SWIPE_THRESHOLD,
};
