import type { HTMLAttributes, ReactNode } from "react";

type CornerRegistrationMarksProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

/**
 * Wraps content with four corner L-registration marks via `.hf-corner-marks`.
 * Decorative only — pointer-events none on marks.
 */
export function CornerRegistrationMarks({
  className = "",
  children,
  ...rest
}: CornerRegistrationMarksProps) {
  return (
    <div className={["hf-corner-marks", className].filter(Boolean).join(" ")} {...rest}>
      <span className="hf-corner-tr" aria-hidden="true" />
      <span className="hf-corner-bl" aria-hidden="true" />
      {children}
    </div>
  );
}
