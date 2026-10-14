import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type SourceName = "github" | "hermes" | "gmail" | "seerr" | "pipeline";

const SOURCE_COLOR: Record<SourceName, string> = {
  github: "var(--source-github)",
  hermes: "var(--source-hermes)",
  gmail: "var(--source-gmail)",
  seerr: "var(--source-seerr)",
  pipeline: "var(--source-pipeline)",
};

export interface InnerCardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "article" | "li" | "section";
  /** Open card: darker fill (.62) and the full #D8E2DC border. */
  open?: boolean;
  /** Waiting items: 3px left border in the source color, fill .42. */
  accent?: SourceName;
}

/**
 * Card inside a panel: rgba(8,18,22,.35) fill and a .35 hairline; background and border
 * transition in 300ms. Padding is the caller's (cards 18px 20px, waiting items 12px 14px).
 */
export function InnerCard({ as: Tag = "div", open = false, accent, className, style, ...rest }: InnerCardProps) {
  return (
    <Tag
      className={cx("inner-card", className)}
      data-open={open ? "" : undefined}
      data-accent={accent ?? undefined}
      style={accent ? { ...style, ["--card-accent" as string]: SOURCE_COLOR[accent] } : style}
      {...rest}
    />
  );
}
