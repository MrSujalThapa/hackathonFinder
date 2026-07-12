import type { HTMLAttributes, ReactNode } from "react";

type StatusStampProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "default" | "warn" | "approve" | "reject";
  children: ReactNode;
};

/** Quiet boxed status stamp (mono caps). */
export function StatusStamp({
  tone = "default",
  className = "",
  children,
  ...rest
}: StatusStampProps) {
  return (
    <span
      className={["hf-status-stamp", className].filter(Boolean).join(" ")}
      data-tone={tone === "default" ? undefined : tone}
      {...rest}
    >
      {children}
    </span>
  );
}
