import { prisma } from "@/lib/db/prisma";
import { runGithubCardMetaJob } from "@/lib/integrations/github/card-meta";
import { syncCalendarTimeline } from "@/lib/integrations/google-calendar/timeline-sync";
import { checkSeerrPending } from "@/lib/integrations/seerr/pending";
import { syncStockHistory, syncStockQuotes } from "@/lib/integrations/stocks/sync";
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

// Pending count from the previous poll; checkSeerrPending publishes seerr.changed when it differs.
let lastSeerrPending: number | null = null;

function failedSummary(failed: { symbol: string }[]): string {
  return failed.length ? ` · failed ${failed.map((entry) => entry.symbol).join(", ")}` : "";
}

/**
 * Every job the worker container runs. To add one, append
 * a single entry. `run` returns a short summary (counts, never secrets) for the log line, and should publish the
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
  {
    // Waiting panel count. The first poll after a restart publishes too.
    name: "seerr-poll",
    trigger: { everyMs: 2 * MINUTE },
    run: async () => {
      const result = await checkSeerrPending(lastSeerrPending);
      lastSeerrPending = result.count;
      return `${result.count} pending${result.changed ? " · changed" : ""}`;
    },
  },
  {
    // Finnhub quotes → stocks banner snapshot (D9). Publishes banner.updated itself.
    name: "stocks-quotes",
    trigger: { everyMs: 5 * MINUTE },
    run: async ({ now }) => {
      const result = await syncStockQuotes(now);
      return `${result.snapshot.rows.length} rows${failedSummary(result.failed)}`;
    },
  },
  {
    // Tiingo end-of-day history → cached 6-month change per symbol; runs once the previous close is final.
    name: "stocks-history",
    trigger: { dailyAt: { hour: 5, minute: 0 } },
    run: async ({ now }) => {
      const result = await syncStockHistory(now);
      return `updated ${result.updated.length} · skipped ${result.skipped.length}${failedSummary(result.failed)}`;
    },
  },
  {
    // GitHub → the card meta line (D7: read-only). Publishes card.upserted for cards whose data changed.
    name: "github-sync",
    trigger: { everyMs: 5 * MINUTE },
    run: async ({ now }) => runGithubCardMetaJob(now),
  },
];
