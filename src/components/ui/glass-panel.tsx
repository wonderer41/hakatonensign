import type { ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";

type SurfaceTag = "section" | "div" | "aside" | "article";

const PADDING = {
  /** 28px: Working on (and the default). */
  section: "p-7",
  /** 22px: Broken and Waiting on you. */
  rail: "p-[22px]",
  /** No padding: the banner, whose slides pad themselves. */
  none: "",
} as const;

export interface GlassPanelProps extends ComponentPropsWithoutRef<"section"> {
  as?: SurfaceTag;
  /** "glass" = pond glass with the light hairline; "broken" = the amber Broken panel. */
  tone?: "glass" | "broken";
  pad?: keyof typeof PADDING;
}

/**
 * The glass surface: banner, Working on, Waiting on you, Broken.
 * Give it an accessible name when it is a landmark: aria-label or aria-labelledby on a section/aside.
 */
export function GlassPanel({ as: Tag = "section", tone = "glass", pad = "section", className, ...rest }: GlassPanelProps) {
  return <Tag className={cx("glass-panel", tone === "broken" && "glass-panel--broken", PADDING[pad], className)} {...rest} />;
}
