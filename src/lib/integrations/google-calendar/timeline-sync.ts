import type { CalendarEventKind, CalendarEventStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, datesSpanned, dashboardTimeZone, dayBounds, localDateString } from "@/lib/time/zone";
import { fetchGoogleCalendarWindow } from "./client";
import { loadGoogleCalendarConfig } from "./config";
import { toCalendarEventFields } from "./timeline-normalize";

// Rolling window kept in the cache: yesterday through two weeks ahead.
const WINDOW_PAST_DAYS = 1;
const WINDOW_FUTURE_DAYS = 14;

export interface CalendarSyncResult {
  calendarId: string;
  window: { start: string; end: string };
  fetched: number;
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  /** False when Google had more pages than we read; missing events were not cancelled. */
  complete: boolean;
  /** Local dates whose timeline changed, for live updates. */
  changedDates: string[];
  syncedAt: string;
}

interface StoredRow {
  id: string;
  externalId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  kind: CalendarEventKind;
  status: CalendarEventStatus;
  checklistItemId: string | null;
  alertId: string | null;
  etag: string | null;
  htmlLink: string | null;
}

type RowValues = Omit<StoredRow, "id" | "externalId">;

function sameValues(row: StoredRow, next: RowValues): boolean {
  return (
    row.title === next.title &&
    row.startsAt.getTime() === next.startsAt.getTime() &&
    row.endsAt.getTime() === next.endsAt.getTime() &&
    row.allDay === next.allDay &&
    row.kind === next.kind &&
    row.status === next.status &&
    row.checklistItemId === next.checklistItemId &&
    row.alertId === next.alertId &&
    row.etag === next.etag &&
    row.htmlLink === next.htmlLink
  );
}

const STORED_FIELDS = {
  id: true,
  externalId: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  kind: true,
  status: true,
  checklistItemId: true,
  alertId: true,
  etag: true,
  htmlLink: true,
} as const;

/** Pulls the rolling window from Google and brings the CalendarEvent cache in line with it. */
export async function syncCalendarTimeline(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<CalendarSyncResult> {
  const config = loadGoogleCalendarConfig(env);
  const timeZone = dashboardTimeZone(env);
  const today = localDateString(now, timeZone);
  const windowStart = dayBounds(addDays(today, -WINDOW_PAST_DAYS), timeZone).start;
  const windowEnd = dayBounds(addDays(today, WINDOW_FUTURE_DAYS), timeZone).end;

  let window;
  try {
    window = await fetchGoogleCalendarWindow(config, windowStart, windowEnd);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar sync failed";
    await prisma.calendarSyncState.upsert({
      where: { calendarId: config.calendarId },
      create: { calendarId: config.calendarId, lastError: message },
      update: { lastError: message },
    });
    throw error;
  }

  // One entry per event id (the last one wins), so a repeated id can't produce two creates.
  const events = [...new Map(window.events.map((event) => [event.id, event])).values()];
  const fetchedIds = events.map((event) => event.id);
  const stored = await prisma.calendarEvent.findMany({
    where: {
      calendarId: config.calendarId,
      OR: [{ externalId: { in: fetchedIds } }, { startsAt: { lt: windowEnd }, endsAt: { gt: windowStart } }],
    },
    select: STORED_FIELDS,
  });
  const byExternalId = new Map(stored.map((row) => [row.externalId, row]));

  const mapped = events.map((event) => ({ event, fields: toCalendarEventFields(event, timeZone) }));
  const itemRefs = [...new Set(mapped.map(({ fields }) => fields?.itemRef).filter((id): id is string => Boolean(id)))];
  const alertRefs = [...new Set(mapped.map(({ fields }) => fields?.alertRef).filter((id): id is string => Boolean(id)))];
  const [items, alerts] = await Promise.all([
    itemRefs.length ? prisma.checklistItem.findMany({ where: { id: { in: itemRefs } }, select: { id: true } }) : [],
    alertRefs.length ? prisma.alert.findMany({ where: { id: { in: alertRefs } }, select: { id: true } }) : [],
  ]);
  const knownItems = new Set(items.map((row) => row.id));
  const knownAlerts = new Set(alerts.map((row) => row.id));

  const changedDates = new Set<string>();
  const markChanged = (start: Date, end: Date) => datesSpanned(start, end, timeZone).forEach((date) => changedDates.add(date));
  const writes = [];
  let created = 0;
  let updated = 0;
  let cancelled = 0;
  let unchanged = 0;

  for (const { event, fields } of mapped) {
    const row = byExternalId.get(event.id);
    if (!fields) {
      // A cancelled stub without times: cancel the row we already have, if any.
      if (row && row.status !== "cancelled") {
        writes.push(prisma.calendarEvent.update({ where: { id: row.id }, data: { status: "cancelled", syncedAt: now } }));
        markChanged(row.startsAt, row.endsAt);
        cancelled += 1;
      } else {
        unchanged += 1;
      }
      continue;
    }

    const values: RowValues = {
      title: fields.title,
      startsAt: fields.startsAt,
      endsAt: fields.endsAt,
      allDay: fields.allDay,
      kind: fields.kind,
      status: fields.status,
      checklistItemId: fields.itemRef && knownItems.has(fields.itemRef) ? fields.itemRef : null,
      alertId: fields.alertRef && knownAlerts.has(fields.alertRef) ? fields.alertRef : null,
      etag: fields.etag,
      htmlLink: fields.htmlLink,
    };

    if (!row) {
      if (values.status === "cancelled") {
        unchanged += 1;
        continue;
      }
      writes.push(prisma.calendarEvent.create({ data: { calendarId: config.calendarId, externalId: event.id, ...values, syncedAt: now } }));
      markChanged(values.startsAt, values.endsAt);
      created += 1;
    } else if (sameValues(row, values)) {
      unchanged += 1;
    } else {
      writes.push(prisma.calendarEvent.update({ where: { id: row.id }, data: { ...values, syncedAt: now } }));
      markChanged(row.startsAt, row.endsAt);
      markChanged(values.startsAt, values.endsAt);
      if (values.status === "cancelled" && row.status !== "cancelled") cancelled += 1;
      else updated += 1;
    }
  }

  // Events deleted outright no longer come back at all; only trust that when we read every page.
  if (window.complete) {
    const returned = new Set(fetchedIds);
    for (const row of stored) {
      const inWindow = row.startsAt < windowEnd && row.endsAt > windowStart;
      if (inWindow && row.status !== "cancelled" && !returned.has(row.externalId)) {
        writes.push(prisma.calendarEvent.update({ where: { id: row.id }, data: { status: "cancelled", syncedAt: now } }));
        markChanged(row.startsAt, row.endsAt);
        cancelled += 1;
      }
    }
  }

  writes.push(
    prisma.calendarSyncState.upsert({
      where: { calendarId: config.calendarId },
      create: { calendarId: config.calendarId, lastSyncAt: now, lastError: null },
      update: { lastSyncAt: now, lastError: null },
    }),
  );
  await prisma.$transaction(writes);

  return {
    calendarId: config.calendarId,
    window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
    fetched: window.events.length,
    created,
    updated,
    cancelled,
    unchanged,
    complete: window.complete,
    changedDates: [...changedDates].sort(),
    syncedAt: now.toISOString(),
  };
}
