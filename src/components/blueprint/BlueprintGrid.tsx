import type { HTMLAttributes, ReactNode } from "react";

type BlueprintGridProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

/** Page-level major/minor drafting grid surface (background only). */
export function BlueprintGrid({
  className = "",
  children,
  ...rest
}: BlueprintGridProps) {
  return (
    <div className={["hf-sheet-grid", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
