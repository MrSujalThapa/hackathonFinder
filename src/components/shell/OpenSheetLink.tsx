"use client";

import type { ReactNode } from "react";

type OpenSheetLinkProps = {
  className?: string;
  children?: ReactNode;
};

export function OpenSheetLink({
  className,
  children = "Open Sheet",
}: OpenSheetLinkProps) {
  const url = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL?.trim() || "";
  const configured = url.length > 0;

  if (!configured) {
    return (
      <span
        className={
          className ??
          "mt-4 inline-flex cursor-not-allowed rounded-xl border border-border px-3 py-2.5 text-sm text-muted opacity-60"
        }
        title="Google Sheet URL is not configured (set NEXT_PUBLIC_GOOGLE_SHEET_URL)"
        aria-disabled="true"
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "mt-4 rounded-xl border border-border/80 px-3 py-2.5 text-sm text-muted transition-colors hover:border-sky-500/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
      }
      title="Open Google Sheet"
    >
      {children}
    </a>
  );
}
