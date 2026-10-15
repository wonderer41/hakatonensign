const ENTRIES = [
  { tone: "short", label: "under 30m" },
  { tone: "medium", label: "30–60m" },
  { tone: "long", label: "over 1h" },
] as const;

/** "free time: under 30m · 30–60m · over 1h" with the three gap colours; the words carry the meaning. */
export function GapLegend() {
  return (
    <p className="tl-legend">
      <span className="tl-legend__lead">
        free time<span className="sr-only">:</span>
      </span>
      {ENTRIES.map((entry, index) => (
        <span key={entry.tone} className="tl-legend__entry">
          <span className="tl-legend__swatch" data-tone={entry.tone} aria-hidden="true" />
          {entry.label}
          {index < ENTRIES.length - 1 ? <span className="sr-only">,</span> : null}
        </span>
      ))}
    </p>
  );
}
