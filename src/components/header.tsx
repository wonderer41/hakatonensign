import type { ReactNode } from "react";
import { SourceLegend } from "./source-legend";

export interface HeaderProps {
  /** e.g. "MONDAY · OCTOBER 12" for the day the page shows. */
  eyebrow: string;
  /** Muted live-status bits next to the date ("Reconnecting…", "Back to today"). */
  status?: ReactNode;
}

export function Header({ eyebrow, status }: HeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="m-0 font-mono text-[12px] leading-normal tracking-[0.16em] text-reflection uppercase">{eyebrow}</p>
          {status}
        </div>
        <h1 className="m-0 font-display text-[clamp(44px,6vw,72px)] leading-[0.95] font-semibold tracking-[-0.015em] text-text-strong">
          Today
        </h1>
      </div>
      <SourceLegend />
    </header>
  );
}
