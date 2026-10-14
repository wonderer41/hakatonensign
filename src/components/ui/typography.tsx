import type { ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";

const EYEBROW_TONE = {
  /** #A9B7B1: slide and group labels ("Daily message", "Gmail · since 08:00"). */
  muted: "text-text-muted",
  /** #E8C77A: the header date, the Seerr bubble heading. */
  reflection: "text-reflection",
} as const;

export interface EyebrowProps extends ComponentPropsWithoutRef<"p"> {
  as?: "p" | "span" | "div" | "h3" | "h4";
  tone?: keyof typeof EYEBROW_TONE;
}

/** JetBrains Mono 12px, uppercase, tracking .16em. */
export function Eyebrow({ as: Tag = "p", tone = "muted", className, ...rest }: EyebrowProps) {
  return <Tag className={cx("m-0 font-mono text-[12px] leading-normal tracking-[0.16em] uppercase", EYEBROW_TONE[tone], className)} {...rest} />;
}

export interface SectionTitleProps extends ComponentPropsWithoutRef<"h2"> {
  as?: "h2" | "h3";
  /** 40px (Working on, default) or 36px (Timeline). */
  size?: 36 | 40;
}

/** Cormorant 600, line-height 1, #F1F4EF. Section headings only. */
export function SectionTitle({ as: Tag = "h2", size = 40, className, ...rest }: SectionTitleProps) {
  return (
    <Tag
      className={cx("m-0 font-display leading-none font-semibold text-text-strong", size === 36 ? "text-[36px]" : "text-[40px]", className)}
      {...rest}
    />
  );
}

export interface RailTitleProps extends ComponentPropsWithoutRef<"h2"> {
  as?: "h2" | "h3";
  /** "amber" inside the Broken panel; otherwise #F1F4EF. */
  tone?: "strong" | "amber";
}

/** Cormorant 30px / 600 for the Warnings rail ("Broken", "Waiting on you"). */
export function RailTitle({ as: Tag = "h2", tone = "strong", className, ...rest }: RailTitleProps) {
  return (
    <Tag
      className={cx("m-0 font-display text-[30px] leading-none font-semibold", tone === "amber" ? "text-amber" : "text-text-strong", className)}
      {...rest}
    />
  );
}
