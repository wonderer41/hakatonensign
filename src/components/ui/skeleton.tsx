import type { CSSProperties } from "react";
import { GlassPanel } from "./glass-panel";
import { cx } from "./cx";
import { SectionTitle } from "./typography";

export interface SkeletonProps {
  /** Size it with utilities, e.g. "h-6 w-40" or "h-24 flex-[0_0_280px]". */
  className?: string;
  style?: CSSProperties;
}

/** A shimmering placeholder block (no spinners). The shimmer stops under prefers-reduced-motion. */
export function Skeleton({ className, style }: SkeletonProps) {
  return <span aria-hidden="true" className={cx("skeleton block", className)} style={style} />;
}

export interface SkeletonPanelProps {
  /** The section's real title, so the page keeps its shape while the data loads. */
  title: string;
  /** Section title size (Timeline uses 36). */
  titleSize?: 36 | 40;
  /** Number of placeholder rows. */
  rows?: number;
  className?: string;
}

/** A glass panel with the section title and skeleton rows; marked busy for assistive tech. */
export function SkeletonPanel({ title, titleSize = 40, rows = 3, className }: SkeletonPanelProps) {
  return (
    <GlassPanel aria-label={title} aria-busy="true" className={cx("flex flex-col gap-[18px]", className)}>
      <SectionTitle size={titleSize}>{title}</SectionTitle>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-6" style={{ width: `${92 - index * 17}%` }} />
      ))}
    </GlassPanel>
  );
}
