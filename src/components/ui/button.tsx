import type { ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";

type NativeButtonProps = Omit<ComponentPropsWithoutRef<"button">, "type"> & {
  /** Defaults to "button" so a button inside a form never submits by accident. */
  type?: "button" | "submit" | "reset";
};

interface TextButtonProps extends NativeButtonProps {
  /**
   * primary   lilac fill, hard 4px #D8E2DC shadow (Schedule with Hermes, Ask Hermes, Approve)
   * secondary dark fill, 4px light shadow (Decline, Not today)
   * alert     amber text and border, 3px amber shadow (Block time)
   * ghost     no fill, faint border, lilac text, no shadow (the per-item Schedule button)
   */
  variant?: "primary" | "secondary" | "alert" | "ghost";
  /** sm = 13px text, 0 14px padding, 3px shadow (Approve / Decline in the Seerr bubble). */
  size?: "md" | "sm";
}

interface IconButtonProps extends NativeButtonProps {
  /** 44×44 square with a 3px light shadow; pass an icon from ./icons as the child. */
  variant: "icon";
  /** Required: icon-only buttons need an accessible name. */
  "aria-label": string;
  size?: never;
}

export type ButtonProps = TextButtonProps | IconButtonProps;

/** Real <button> with min-height 44px, sharp edges and the hard offset shadows. */
export function Button({ variant = "primary", size = "md", type = "button", className, ...rest }: ButtonProps) {
  return <button type={type} className={cx("btn", `btn--${variant}`, size === "sm" && variant !== "icon" && "btn--sm", className)} {...rest} />;
}
