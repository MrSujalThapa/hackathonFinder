"use client";

import { DesktopSidebar, MobileNavigation } from "@/components/shell/Navigation";

type AppShellProps = {
  children: React.ReactNode;
  /** Optional override; otherwise Navigation reads live counts from clientStore. */
  queueCount?: number;
};

export function AppShell({ children, queueCount }: AppShellProps) {
  return (
    <div className="flex min-h-dvh w-full">
      <DesktopSidebar queueCount={queueCount} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hf-shell-main mx-auto flex w-full min-w-0 flex-1 flex-col overflow-x-hidden pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[calc(var(--nav-mobile-height)+env(safe-area-inset-bottom,0px))] pt-[max(1rem,env(safe-area-inset-top,0px))] sm:pl-[max(1.5rem,env(safe-area-inset-left,0px))] sm:pr-[max(1.5rem,env(safe-area-inset-right,0px))] lg:pb-8 lg:pt-6">
          {children}
        </div>
        <MobileNavigation queueCount={queueCount} />
      </div>
    </div>
  );
}
