import type { ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";

export interface ChipProps extends ComponentPropsWithoutRef<"span"> {
  /**
   * in-progress  lilac text on lilac tint with a lilac border ("In progress", booked time tags "19:00–20:30")
   * open         light text, light border ("Open")
   * neutral      muted text, faint border (counts, "done", anything secondary)
   */
  tone?: "in-progress" | "open" | "neutral";
}

/** JetBrains Mono 12px, padding 3px 8px, square. The word carries the meaning, never the color alone. */
export function Chip({ tone = "neutral", className, ...rest }: ChipProps) {
  return <span className={cx("chip", `chip--${tone}`, className)} {...rest} />;
}
