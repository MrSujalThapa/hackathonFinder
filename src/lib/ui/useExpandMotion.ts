"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Expand/collapse an element with GSAP; falls back to instant when reduced-motion. */
export function useExpandMotion(open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (first.current) {
      first.current = false;
      if (!open) {
        gsap.set(el, { height: 0, opacity: 0, overflow: "hidden" });
      } else {
        gsap.set(el, { height: "auto", opacity: 1, overflow: "hidden" });
      }
      return;
    }

    if (prefersReducedMotion()) {
      gsap.set(el, {
        height: open ? "auto" : 0,
        opacity: open ? 1 : 0,
        overflow: "hidden",
      });
      return;
    }

    if (open) {
      gsap.fromTo(
        el,
        { height: 0, opacity: 0 },
        {
          height: "auto",
          opacity: 1,
          duration: 0.28,
          ease: "power2.out",
          overflow: "hidden",
        },
      );
    } else {
      gsap.to(el, {
        height: 0,
        opacity: 0,
        duration: 0.2,
        ease: "power2.in",
        overflow: "hidden",
      });
    }
  }, [open]);

  return ref;
}
