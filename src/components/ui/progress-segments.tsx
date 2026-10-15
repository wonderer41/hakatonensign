import { cx } from "./cx";

export interface ProgressSegmentsProps {
  /** One entry per checklist item, in checklist order: true = done (lilac), false = open (outline). */
  segments: readonly boolean[];
  /** Accessible name, e.g. "study-sessions progress". The value is read as "5 of 8 done". */
  label: string;
  className?: string;
}

/** Grid of N equal segments, 10px tall, 4px gap. */
export function ProgressSegments({ segments, label, className }: ProgressSegmentsProps) {
  if (segments.length === 0) return null;
  const done = segments.filter(Boolean).length;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={segments.length}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${segments.length} done`}
      className={cx("progress-segments", className)}
      style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
    >
      {segments.map((isDone, index) => (
        <span key={index} data-done={isDone ? "" : undefined} />
      ))}
    </div>
  );
}
