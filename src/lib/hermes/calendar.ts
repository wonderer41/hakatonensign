import { HttpError } from "@/lib/api/http";
import { loadGoogleCalendarConfig } from "@/lib/integrations/google-calendar/config";
import { runCalendarSync } from "@/lib/worker/jobs";
import type { CalendarJobResult } from "@/lib/worker/calendar-job";
import type { HermesCalendarChangedResult } from "@/types/dashboard-contracts";

// POST /api/hermes/calendar/changed: Hermes just created or moved an event, so pull the
// calendar window now instead of waiting for the next poll. Syncs in this process run one at a
// time (a second request waits, then syncs again so it sees the newest change).

const globalForSync = globalThis as unknown as { hermesCalendarSync?: Promise<unknown> };

/** Google failures are reported as 502 so Hermes never mistakes a Google 401 for its own token being wrong. */
function asUpstream(error: unknown, prefix: string): unknown {
  if (error instanceof HttpError) return new HttpError("UPSTREAM_ERROR", `${prefix}: ${error.message}`);
  return error;
}

export async function syncCalendarNow(env: NodeJS.ProcessEnv = process.env): Promise<HermesCalendarChangedResult> {
  try {
    loadGoogleCalendarConfig(env);
  } catch (error) {
    throw asUpstream(error, "Google Calendar is not set up on the dashboard");
  }

  const previous = globalForSync.hermesCalendarSync ?? Promise.resolve();
  // Same job as the worker runs, so the same timeline.changed rules apply (changed dates, and
  // today when the sync error appears or clears).
  const run: Promise<CalendarJobResult> = previous.catch(() => undefined).then(() => runCalendarSync(new Date(), env));
  globalForSync.hermesCalendarSync = run;

  let result: CalendarJobResult["sync"];
  try {
    result = (await run).sync;
  } catch (error) {
    throw asUpstream(error, "Google Calendar sync failed");
  }

  return {
    calendarId: result.calendarId,
    changedDates: result.changedDates,
    created: result.created,
    updated: result.updated,
    cancelled: result.cancelled,
    unchanged: result.unchanged,
    syncedAt: result.syncedAt,
  };
}
