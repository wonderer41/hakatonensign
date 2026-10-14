import type { CalendarSyncResult } from "@/lib/integrations/google-calendar/timeline-sync";
import { localDateString } from "@/lib/time/zone";
import type { LiveEvent } from "@/types/dashboard-contracts";

export interface CalendarJobDeps {
  sync: (now: Date) => Promise<CalendarSyncResult>;
  /** CalendarSyncState.lastError for the configured calendar; undefined when unknown. */
  readSyncError: () => Promise<string | null | undefined>;
  publish: (event: LiveEvent) => Promise<void>;
}

export interface CalendarJobResult {
  sync: CalendarSyncResult;
  publishedDates: string[];
}

/**
 * Dates that get a `timeline.changed` event: every date the sync changed, plus today when the
 * stored sync error appeared, changed or cleared (the timeline shows it as `syncError`).
 */
export function timelineDatesToPublish(changedDates: string[], today: string, errorBefore: string | null | undefined, errorAfter: string | null | undefined): string[] {
  const dates = new Set(changedDates);
  if (errorBefore !== undefined && errorAfter !== undefined && (errorBefore ?? null) !== (errorAfter ?? null)) dates.add(today);
  return [...dates].sort();
}

async function readSafely(deps: CalendarJobDeps): Promise<string | null | undefined> {
  try {
    return await deps.readSyncError();
  } catch {
    return undefined;
  }
}

/**
 * One calendar-sync run: syncs the CalendarEvent cache and publishes `timeline.changed` for each
 * affected local date. Used by the worker job and by `npm run sync:calendar`. Rethrows sync errors
 * after publishing the error state, so the caller logs the failure.
 */
export async function syncCalendarAndPublish(now: Date, timeZone: string, deps: CalendarJobDeps): Promise<CalendarJobResult> {
  const today = localDateString(now, timeZone);
  const errorBefore = await readSafely(deps);
  let sync: CalendarSyncResult;
  try {
    sync = await deps.sync(now);
  } catch (error) {
    const errorAfter = await readSafely(deps);
    for (const date of timelineDatesToPublish([], today, errorBefore, errorAfter)) {
      await deps.publish({ type: "timeline.changed", date });
    }
    throw error;
  }

  // A successful sync always clears lastError.
  const publishedDates = timelineDatesToPublish(sync.changedDates, today, errorBefore, errorBefore === undefined ? undefined : null);
  for (const date of publishedDates) await deps.publish({ type: "timeline.changed", date });
  return { sync, publishedDates };
}

export function formatCalendarJobResult({ sync, publishedDates }: CalendarJobResult): string {
  const counts = `fetched ${sync.fetched} · created ${sync.created} · updated ${sync.updated} · cancelled ${sync.cancelled} · unchanged ${sync.unchanged}`;
  const incomplete = sync.complete ? "" : " · incomplete window";
  const published = publishedDates.length ? ` · timeline.changed ${publishedDates.join(", ")}` : "";
  return `${counts}${incomplete}${published}`;
}
