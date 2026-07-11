"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { CandidateCard } from "@/core/candidates/types";
import { CandidateCardView } from "@/components/candidates/CandidateCard";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { QueueDecision } from "@/hooks/useCandidateQueue";

gsap.registerPlugin(useGSAP);

const SWIPE_THRESHOLD = 110;
const SAVE_THRESHOLD = 90;

type SwipeDeckProps = {
  candidate: CandidateCard;
  upcoming?: CandidateCard | null;
  busy?: boolean;
  onDecision: (
    action: QueueDecision,
    candidateId?: string,
  ) => Promise<{ ok: boolean }>;
};

export function SwipeDeck({
  candidate,
  upcoming,
  busy = false,
  onDecision,
}: SwipeDeckProps) {
  const reducedMotion = usePrefersReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef({
    active: false,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
  });
  const [expanded, setExpanded] = useState(false);
  const [overlay, setOverlay] = useState<"approve" | "reject" | "save" | null>(
    null,
  );
  const exitingRef = useRef(false);

  useGSAP(
    () => {
      if (!cardRef.current || reducedMotion) return;
      gsap.fromTo(
        cardRef.current,
        { autoAlpha: 0, scale: 0.96, y: 12 },
        { autoAlpha: 1, scale: 1, y: 0, duration: 0.22, ease: "power2.out" },
      );
    },
    { dependencies: [candidate.id, reducedMotion], revertOnUpdate: true },
  );

  useEffect(() => {
    setExpanded(false);
    setOverlay(null);
    exitingRef.current = false;
    if (cardRef.current) {
      gsap.set(cardRef.current, { x: 0, y: 0, rotation: 0, autoAlpha: 1 });
    }
  }, [candidate.id]);

  const exitAndDecide = useCallback(
    async (action: QueueDecision) => {
      if (exitingRef.current || busy) return;
      exitingRef.current = true;
      setOverlay(action === "save" ? "save" : action === "approve" ? "approve" : "reject");

      const el = cardRef.current;
      const duration = reducedMotion ? 0.01 : 0.22;
      if (el) {
        const x =
          action === "approve" ? window.innerWidth : action === "reject" ? -window.innerWidth : 0;
        const y = action === "save" ? -window.innerHeight * 0.35 : 0;
        const rotation = action === "approve" ? 18 : action === "reject" ? -18 : 0;
        await gsap.to(el, {
          x,
          y,
          rotation,
          autoAlpha: 0,
          duration,
          ease: "power2.in",
        });
      }

      // Fire mutation without waiting on animation beyond exit.
      const result = await onDecision(action, candidate.id);
      if (!result.ok && el) {
        gsap.set(el, { x: 0, y: 0, rotation: 0, autoAlpha: 1 });
        exitingRef.current = false;
        setOverlay(null);
      }
    },
    [busy, candidate.id, onDecision, reducedMotion],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy || exitingRef.current || expanded) return;
    drag.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      x: 0,
      y: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active || !cardRef.current) return;
    const x = event.clientX - drag.current.startX;
    const y = event.clientY - drag.current.startY;
    drag.current.x = x;
    drag.current.y = y;
    const rotation = gsap.utils.clamp(-15, 15, x * 0.06);
    gsap.set(cardRef.current, { x, y: y * 0.35, rotation });

    if (x > SWIPE_THRESHOLD * 0.55) setOverlay("approve");
    else if (x < -SWIPE_THRESHOLD * 0.55) setOverlay("reject");
    else if (y < -SAVE_THRESHOLD * 0.55 && Math.abs(x) < 60) setOverlay("save");
    else setOverlay(null);
  };

  const onPointerUp = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    const { x, y } = drag.current;

    if (x > SWIPE_THRESHOLD) {
      void exitAndDecide("approve");
      return;
    }
    if (x < -SWIPE_THRESHOLD) {
      void exitAndDecide("reject");
      return;
    }
    if (y < -SAVE_THRESHOLD && Math.abs(x) < 80) {
      void exitAndDecide("save");
      return;
    }

    setOverlay(null);
    if (cardRef.current) {
      gsap.to(cardRef.current, {
        x: 0,
        y: 0,
        rotation: 0,
        duration: reducedMotion ? 0.01 : 0.2,
        ease: "power2.out",
      });
    }
  };

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
      if (busy || exitingRef.current) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void exitAndDecide("reject");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void exitAndDecide("approve");
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        void exitAndDecide("save");
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setExpanded((value) => !value);
      } else if (event.key === "Escape") {
        setExpanded(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, exitAndDecide]);

  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      {upcoming ? (
        <div
          className="pointer-events-none absolute inset-x-3 top-3 -z-10 scale-[0.97] opacity-40"
          aria-hidden
        >
          <CandidateCardView candidate={upcoming} />
        </div>
      ) : null}

      <div
        ref={cardRef}
        className="relative touch-none will-change-transform"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {overlay ? (
          <div
            className={[
              "pointer-events-none absolute left-1/2 top-8 z-10 -translate-x-1/2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]",
              overlay === "approve"
                ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                : overlay === "reject"
                  ? "border-slate-300/40 bg-slate-500/20 text-slate-100"
                  : "border-sky-400/50 bg-sky-500/20 text-sky-100",
            ].join(" ")}
          >
            {overlay}
          </div>
        ) : null}

        <CandidateCardView
          candidate={candidate}
          expanded={expanded}
          onToggleDetails={() => setExpanded((value) => !value)}
          onApprove={() => void exitAndDecide("approve")}
          onReject={() => void exitAndDecide("reject")}
          onSave={() => void exitAndDecide("save")}
          busy={busy || exitingRef.current}
        />
      </div>

      <p className="mt-4 text-center text-[11px] text-muted">
        ← reject · → approve · S save · Enter details
      </p>
    </div>
  );
}

/** Exported for unit tests */
export const SWIPE_THRESHOLDS = {
  horizontal: SWIPE_THRESHOLD,
  save: SAVE_THRESHOLD,
};
