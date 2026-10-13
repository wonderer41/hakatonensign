import { prisma } from "@/lib/db/prisma";
import { dashboardTimeZone, dayBounds } from "@/lib/time/zone";
import type { TimelineResponse } from "@/types/dashboard-contracts";
import { buildTimeline } from "./build";

/** The timeline for one local date, read from the CalendarEvent cache (never from Google directly). */
export async function getTimeline(date: string, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<TimelineResponse> {
  const timeZone = dashboardTimeZone(env);
  const calendarId = env.GOOGLE_CALENDAR_ID?.trim();
  if (!calendarId) {
    return buildTimeline({ date, timeZone, now, events: [], lastSyncAt: null, syncError: "Google Calendar is not configured" });
  }

  const { start, end } = dayBounds(date, timeZone);
  const [events, syncState] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { calendarId, status: { not: "cancelled" }, startsAt: { lt: end }, endsAt: { gt: start } },
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
    prisma.calendarSyncState.findUnique({ where: { calendarId }, select: { lastSyncAt: true, lastError: true } }),
  ]);

  return buildTimeline({
    date,
    timeZone,
    now,
    events,
    lastSyncAt: syncState?.lastSyncAt ?? null,
    syncError: syncState?.lastError ?? null,
  });
}
