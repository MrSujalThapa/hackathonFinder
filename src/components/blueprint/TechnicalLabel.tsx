import type { HTMLAttributes, ReactNode } from "react";

type TechnicalLabelProps = HTMLAttributes<HTMLElement> & {
  as?: "p" | "span" | "div" | "label";
  children: ReactNode;
};

/** Mono uppercase meta label for drafting chrome. */
export function TechnicalLabel({
  as: Tag = "p",
  className = "",
  children,
  ...rest
}: TechnicalLabelProps) {
  return (
    <Tag className={["hf-technical-label", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </Tag>
  );
}
