import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./cx";

type InputProps = Omit<ComponentPropsWithoutRef<"input">, "type">;

/** Square, rgba(8,18,22,.8) fill, #D8E2DC border, JetBrains Mono 15px, color-scheme dark, min-height 44px. */
export function TextInput({ className, ...rest }: InputProps) {
  return <input type="text" className={cx("input", className)} {...rest} />;
}

/** Whole numbers by default (inputMode numeric). Set min/max/step yourself, e.g. 1–720 for a length. */
export function NumberInput({ className, inputMode = "numeric", ...rest }: InputProps) {
  return <input type="number" inputMode={inputMode} className={cx("input", className)} {...rest} />;
}

/** Native time picker, value "HH:MM". */
export function TimeInput({ className, ...rest }: InputProps) {
  return <input type="time" className={cx("input", className)} {...rest} />;
}

export interface FieldProps {
  /** Mono 11px uppercase caption, e.g. "Start" or "Length · min". */
  label: ReactNode;
  /** The input (and anything shown beside it, like the "1 h 23 min" echo). */
  children: ReactNode;
  className?: string;
}

/** A <label> wrapping its caption and input, stacked with a 4px gap (as in the scheduling form). */
export function Field({ label, children, className }: FieldProps) {
  return (
    <label className={cx("field", className)}>
      {label}
      {children}
    </label>
  );
}
