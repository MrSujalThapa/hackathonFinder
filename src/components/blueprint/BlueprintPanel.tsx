import type { HTMLAttributes, ReactNode } from "react";

type BlueprintPanelProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "aside";
  framed?: boolean;
  corners?: boolean;
  children: ReactNode;
};

/** Flat drafting sheet panel — double hairline, optional corner marks. */
export function BlueprintPanel({
  as: Tag = "div",
  framed = true,
  corners = true,
  className = "",
  children,
  ...rest
}: BlueprintPanelProps) {
  return (
    <Tag
      className={[
        framed ? "hf-panel" : "hf-card",
        corners ? "hf-corner-marks" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {corners ? (
        <>
          <span className="hf-corner-tr" aria-hidden="true" />
          <span className="hf-corner-bl" aria-hidden="true" />
        </>
      ) : null}
      {children}
    </Tag>
  );
}
