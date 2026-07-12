"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BlueprintTitleBlock } from "@/components/blueprint/BlueprintTitleBlock";
import { LogoutButton } from "@/components/shell/LogoutButton";
import { OpenSheetLink } from "@/components/shell/OpenSheetLink";
import { getCounts, subscribe } from "@/lib/candidates/clientStore";

const NAV_ITEMS = [
  { href: "/queue", label: "Queue", icon: "◈" },
  { href: "/terminal", label: "Terminal", icon: "$" },
  { href: "/approved", label: "Approved", icon: "✓" },
  { href: "/saved", label: "Saved", icon: "◇" },
  { href: "/rejected", label: "Rejected", icon: "✕" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

function navClass(active: boolean): string {
  return [
    "hf-nav-link hf-focus flex items-center gap-3 px-3 py-2.5 text-sm transition-colors duration-[var(--duration-fast)]",
    active
      ? "text-foreground"
      : "text-muted hover:bg-[color-mix(in_oklab,var(--foreground)_3%,transparent)] hover:text-foreground",
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
    <aside className="hidden w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border-subtle bg-surface px-3 py-6 lg:flex">
      <BlueprintTitleBlock
        className="mb-8"
        title={
          <Link href="/queue" className="hf-focus block text-inherit">
            Hackathon Radar
          </Link>
        }
        meta="Dwg · Review · Scale 1:1"
      />

      <nav className="flex flex-1 flex-col gap-1" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={navClass(active)}
              data-active={active ? "true" : "false"}
              aria-current={active ? "page" : undefined}
            >
              <span className="w-4 text-center text-xs opacity-70" aria-hidden>
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
              {item.href === "/queue" && typeof resolvedCount === "number" ? (
                <span className="border border-[color-mix(in_oklab,var(--ink-line)_80%,transparent)] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-foreground/80">
                  {resolvedCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <OpenSheetLink className="hf-focus mt-4 rounded-[var(--radius-control)] border border-border px-3 py-2.5 text-sm text-muted transition-colors hover:border-[color-mix(in_oklab,var(--accent-save)_45%,transparent)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60" />
      <LogoutButton className="hf-focus mt-2 rounded-[var(--radius-control)] border border-border px-3 py-2.5 text-left text-sm text-muted transition-colors hover:border-[color-mix(in_oklab,var(--accent-warn)_45%,transparent)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60" />
    </aside>
  );
}

export function MobileNavigation({ queueCount }: { queueCount?: number }) {
  const pathname = usePathname();
  const resolvedCount = useQueueCount(queueCount);

  return (
    <nav
      className="hf-nav-mobile fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] lg:hidden"
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
                  "hf-focus flex flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-medium",
                  active ? "text-foreground" : "text-muted",
                ].join(" ")}
                aria-current={active ? "page" : undefined}
              >
                <span className="relative text-sm" aria-hidden>
                  {item.icon}
                  {item.href === "/queue" &&
                  typeof resolvedCount === "number" &&
                  resolvedCount > 0 ? (
                    <span className="absolute -right-2.5 -top-1 min-w-4 border border-[color-mix(in_oklab,var(--accent-save)_55%,transparent)] bg-[color-mix(in_oklab,var(--accent-save)_22%,var(--background))] px-1 font-mono text-[9px] leading-4 text-[color-mix(in_oklab,var(--accent-save)_92%,white)]">
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
          <LogoutButton className="hf-focus flex w-full flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-medium text-muted" />
        </li>
      </ul>
    </nav>
  );
}
