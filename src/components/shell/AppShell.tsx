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
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-24 pt-4 sm:px-6 lg:pb-8 lg:pt-6">
          {children}
        </div>
        <MobileNavigation queueCount={queueCount} />
      </div>
    </div>
  );
}
