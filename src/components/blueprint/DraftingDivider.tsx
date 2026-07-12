import type { HTMLAttributes } from "react";

type DraftingDividerProps = HTMLAttributes<HTMLHRElement>;

/** Dashed secondary construction rule. */
export function DraftingDivider({ className = "", ...rest }: DraftingDividerProps) {
  return <hr className={["hf-rule-dashed", className].filter(Boolean).join(" ")} {...rest} />;
}
