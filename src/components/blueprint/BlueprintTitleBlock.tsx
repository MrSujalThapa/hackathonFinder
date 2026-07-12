import type { HTMLAttributes, ReactNode } from "react";

type BlueprintTitleBlockProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
};

/** Compact title-block strip for sidebar brand / sheet meta. */
export function BlueprintTitleBlock({
  title,
  meta,
  className = "",
  children,
  ...rest
}: BlueprintTitleBlockProps) {
  return (
    <div className={["hf-title-block", className].filter(Boolean).join(" ")} {...rest}>
      <div className="text-[15px] font-semibold tracking-tight text-foreground">{title}</div>
      {meta ? (
        <p className="hf-technical-label mt-1.5 text-muted">{meta}</p>
      ) : null}
      {children}
    </div>
  );
}
