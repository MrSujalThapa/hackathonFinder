"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/shell/LogoutButton";
import { OpenSheetLink } from "@/components/shell/OpenSheetLink";
import { getCounts, subscribe } from "@/lib/candidates/clientStore";

const NAV_ITEMS = [
  { href: "/queue", label: "Queue", icon: "◈" },
  { href: "/approved", label: "Approved", icon: "✓" },
  { href: "/saved", label: "Saved", icon: "◇" },
  { href: "/rejected", label: "Rejected", icon: "✕" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

function navClass(active: boolean): string {
  return [
    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60",
    active
      ? "bg-white/10 text-foreground"
      : "text-muted hover:bg-white/5 hover:text-foreground",
  ].join(" ");
}

function useQueueCount(override?: number): number | undefined {
  const [count, setCount] = useState<number | undefined>(() =>
    typeof override === "number" ? override : getCounts().queue,
  );

  useEffect(() => {
    if (typeof override === "number") {
      setCount(override);
      return;
    }
    setCount(getCounts().queue);
    return subscribe(() => setCount(getCounts().queue));
  }, [override]);

  return count;
}

export function DesktopSidebar({ queueCount }: { queueCount?: number }) {
  const pathname = usePathname();
  const resolvedCount = useQueueCount(queueCount);

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border/70 bg-card/40 px-3 py-6 lg:flex">
      <div className="mb-8 px-2">
        <Link
          href="/queue"
          className="block text-lg font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
        >
          Hackathon Radar
        </Link>
        <p className="mt-1 text-xs text-muted">Review & approve</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={navClass(active)}
              aria-current={active ? "page" : undefined}
            >
              <span className="w-4 text-center text-xs opacity-70" aria-hidden>
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
              {item.href === "/queue" && typeof resolvedCount === "number" ? (
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] tabular-nums text-foreground/80">
                  {resolvedCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <OpenSheetLink className="mt-4 rounded-xl border border-border/80 px-3 py-2.5 text-sm text-muted transition-colors hover:border-sky-500/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:cursor-not-allowed disabled:opacity-60" />
      <LogoutButton className="mt-2 rounded-xl border border-border/80 px-3 py-2.5 text-left text-sm text-muted transition-colors hover:border-amber-500/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:cursor-not-allowed disabled:opacity-60" />
    </aside>
  );
}

export function MobileNavigation({ queueCount }: { queueCount?: number }) {
  const pathname = usePathname();
  const resolvedCount = useQueueCount(queueCount);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      aria-label="Primary mobile"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-1">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={[
                  "flex flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-medium",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/60",
                  active ? "text-foreground" : "text-muted",
                ].join(" ")}
                aria-current={active ? "page" : undefined}
              >
                <span className="relative text-sm" aria-hidden>
                  {item.icon}
                  {item.href === "/queue" &&
                  typeof resolvedCount === "number" &&
                  resolvedCount > 0 ? (
                    <span className="absolute -right-2.5 -top-1 min-w-4 rounded-full bg-sky-500 px-1 text-[9px] leading-4 text-white">
                      {resolvedCount > 99 ? "99+" : resolvedCount}
                    </span>
                  ) : null}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <LogoutButton className="flex w-full flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/60" />
        </li>
      </ul>
    </nav>
  );
}
