import { SourceLegend } from "./source-legend";

export function Header({ eyebrow }: { eyebrow: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-reflection">{eyebrow}</p>
        <h1 className="mt-2 font-display text-[clamp(44px,6vw,72px)] leading-[0.95] font-semibold tracking-[-0.015em] text-text-strong">
          Today
        </h1>
      </div>
      <SourceLegend />
    </header>
  );
}
