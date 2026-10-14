import { formatClock, localDateString } from "@/lib/time/zone";
import type { SourceStateDto } from "@/types/dashboard-contracts";
import { cx } from "./cx";

/**
 * "Calendar unavailable — last synced 10:42". A sync from an earlier day reads
 * "last synced Oct 12, 10:42"; with no sync on record the server's one-line reason is shown.
 */
export function formatSourceDown(
  name: string,
  source: SourceStateDto,
  timeZone: string,
  now: Date,
  verb: "synced" | "checked" = "synced",
): string {
  if (source.lastSyncAt) {
    const at = new Date(source.lastSyncAt);
    const clock = formatClock(at, timeZone);
    const sameDay = localDateString(at, timeZone) === localDateString(now, timeZone);
    const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(at);
    return `${name} unavailable — last ${verb} ${sameDay ? clock : `${day}, ${clock}`}`;
  }
  return `${name} unavailable — ${source.error ?? `not ${verb} yet`}`;
}

export interface SourceDownProps {
  /** Shown first: "Calendar", "Seerr". */
  name: string;
  source: SourceStateDto;
  timeZone: string;
  /** ISO "now" from useDashboard(), so the line re-renders on the minute tick without a hydration mismatch. */
  now: string;
  /** "checked" for live checks (Seerr), "synced" for syncs (Calendar). */
  verb?: "synced" | "checked";
  className?: string;
}

/** One plain muted line when a source is down; renders nothing while it is ok. The section keeps working. */
export function SourceDown({ name, source, timeZone, now, verb, className }: SourceDownProps) {
  if (source.ok) return null;
  return (
    <p className={cx("m-0 flex items-baseline gap-2 text-[13px] leading-normal text-text-muted", className)}>
      <span aria-hidden="true" className="inline-block size-2 shrink-0 bg-amber" />
      <span>{formatSourceDown(name, source, timeZone, new Date(now), verb)}</span>
    </p>
  );
}
