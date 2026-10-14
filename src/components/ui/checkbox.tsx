import type { ReactNode } from "react";
import { cx } from "./cx";

export interface CheckboxRowProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Row content after the box (issue number, title). It is the checkbox's label. */
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Native checkbox (18×18, accent lilac) whose whole row is the <label>, min-height 48px.
 * Checked rows turn #7E8C87 in 250ms; children inherit it through currentColor.
 */
export function CheckboxRow({ checked, onCheckedChange, children, disabled, className }: CheckboxRowProps) {
  return (
    <label className={cx("check-row", className)} data-checked={checked ? "" : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onCheckedChange(event.target.checked)} />
      {children}
    </label>
  );
}
