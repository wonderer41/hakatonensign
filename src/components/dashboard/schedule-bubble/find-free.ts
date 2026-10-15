import type { TimelineEventDto } from "@/types/dashboard-contracts";
import { DAY_MINUTES, wallMinutes } from "./format";

export interface BusyRange {
  /** Local minutes after midnight. */
  start: number;
  end: number;
}

/**
 * Next free slot of `durationMin` at or after `fromMin`, or null when none is left before midnight.
 * Powers the conflict reply's "Use 20:30" button.
 */
export function findFree(fromMin: number, durationMin: number, events: readonly BusyRange[]): number | null {
  let t = fromMin;
  for (const ev of [...events].sort((a, b) => a.start - b.start)) {
    if (ev.end <= t) continue;
    if (ev.start >= t + durationMin) return t;
    t = Math.max(t, ev.end);
  }
  return t + durationMin <= DAY_MINUTES ? t : null;
}

/**
 * The page's timed events on `date` as busy ranges. All-day events don't block time, and the
 * target's own work block is skipped so a reschedule doesn't collide with the block it replaces.
 */
export function busyRanges(
  events: readonly TimelineEventDto[],
  date: string,
  timeZone: string,
  skip: { checklistItemId?: string; alertId?: string } = {},
): BusyRange[] {
  return events
    .filter((event) => !event.allDay)
    .filter((event) => !(skip.checklistItemId && event.checklistItemId === skip.checklistItemId))
    .filter((event) => !(skip.alertId && event.alertId === skip.alertId))
    .map((event) => ({ start: wallMinutes(event.startsAt, date, timeZone), end: wallMinutes(event.endsAt, date, timeZone) }))
    .filter((range) => range.end > range.start);
}
