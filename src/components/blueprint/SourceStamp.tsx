import type { HTMLAttributes, ReactNode } from "react";

type SourceStampProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
};

/** Quiet source credibility stamp with left construction rule. */
export function SourceStamp({
  className = "",
  children,
  ...rest
}: SourceStampProps) {
  return (
    <span className={["hf-source-stamp", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </span>
  );
}
