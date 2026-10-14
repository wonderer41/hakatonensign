import { prisma } from "@/lib/db/prisma";
import { dashboardTimeZone, dayBounds } from "@/lib/time/zone";
import type { TimelineResponse } from "@/types/dashboard-contracts";
import { buildTimeline } from "./build";

/**
 * calendarId of the demo events written by `npm run db:seed` (scripts/seed.ts). The Google sync
 * only touches rows of its own calendarId, so it never cancels these; `npm run db:seed -- --clean`
 * deletes them.
 */
export const SEED_CALENDAR_ID = "seed";

/** The timeline for one local date, read from the CalendarEvent cache (never from Google directly). */
export async function getTimeline(date: string, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<TimelineResponse> {
  const timeZone = dashboardTimeZone(env);
  const calendarId = env.GOOGLE_CALENDAR_ID?.trim();
  // The demo seed (scripts/seed.ts) writes to its own calendar; it is only shown outside production.
  const calendarIds = calendarId ? [calendarId] : [];
  if (env.NODE_ENV !== "production") calendarIds.push(SEED_CALENDAR_ID);

  const { start, end } = dayBounds(date, timeZone);
  const [events, syncState] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { calendarId: { in: calendarIds }, status: { not: "cancelled" }, startsAt: { lt: end }, endsAt: { gt: start } },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        kind: true,
        checklistItemId: true,
        alertId: true,
        htmlLink: true,
      },
    }),
    calendarId ? prisma.calendarSyncState.findUnique({ where: { calendarId }, select: { lastSyncAt: true, lastError: true } }) : null,
  ]);

  return buildTimeline({
    date,
    timeZone,
    now,
    events,
    lastSyncAt: syncState?.lastSyncAt ?? null,
    syncError: calendarId ? (syncState?.lastError ?? null) : "Google Calendar is not configured",
  });
}
