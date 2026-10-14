import { prisma } from "@/lib/db/prisma";
import { syncCalendarTimeline } from "@/lib/integrations/google-calendar/timeline-sync";
import { publishLiveEvent, sendLiveEvent } from "@/lib/live/publish";
import { dashboardTimeZone, localDateString } from "@/lib/time/zone";
import { type CalendarJobResult, formatCalendarJobResult, syncCalendarAndPublish } from "./calendar-job";
import { formatRetentionResult, runRetention } from "./retention";
import type { WorkerJob } from "./scheduler";

const MINUTE = 60_000;

/** Calendar sync + live updates, wired to the real database, Google and NOTIFY. */
export function runCalendarSync(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<CalendarJobResult> {
  const calendarId = env.GOOGLE_CALENDAR_ID?.trim();
  return syncCalendarAndPublish(now, dashboardTimeZone(env), {
    sync: (at) => syncCalendarTimeline(at, env),
    readSyncError: async () => {
      if (!calendarId) return undefined;
      const state = await prisma.calendarSyncState.findUnique({ where: { calendarId }, select: { lastError: true } });
      return state?.lastError ?? null;
    },
    publish: publishLiveEvent,
  });
}

/**
 * Every job the worker container runs (for-claude/docs/04-API.md, section D). To add one, append
 * a single entry, e.g.
 *
 *   { name: "stocks-quotes", trigger: { everyMs: 5 * MINUTE }, run: async () => summarize(await syncStockQuotes()) },
 *   { name: "stocks-history", trigger: { dailyAt: { hour: 18, minute: 0 } }, run: async () => summarize(await syncStockHistory()) },
 *
 * `run` returns a short summary (counts, never secrets) for the log line, and should publish the
 * LiveEvents for whatever it changed. Throwing marks the run failed; the job still runs next time.
 */
export const workerJobs: WorkerJob[] = [
  {
    name: "calendar-sync",
    trigger: { everyMs: 2 * MINUTE },
    run: async ({ now }) => formatCalendarJobResult(await runCalendarSync(now)),
  },
  {
    name: "day-rollover",
    trigger: { dailyAt: { hour: 0, minute: 0 } },
    run: async ({ scheduledFor, timeZone }) => {
      // The planned instant is exactly local midnight, so its date is the new day even if the timer fired early.
      const date = localDateString(scheduledFor, timeZone);
      await sendLiveEvent({ type: "day.rollover", date });
      return `day.rollover ${date}`;
    },
  },
  {
    name: "retention",
    trigger: { dailyAt: { hour: 3, minute: 30 } },
    run: async ({ now, timeZone }) => formatRetentionResult(await runRetention(prisma, now, timeZone)),
  },
];
