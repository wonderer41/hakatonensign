import type { CalendarEventKind, CalendarEventStatus } from "@/generated/prisma/client";
import { addDays, dayBounds } from "@/lib/time/zone";
import type { GoogleCalendarWindowEvent } from "./client";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ITEM_MARKER = new RegExp(`\\[homelab-daily:item:(${UUID})\\]`, "i");
const ALERT_MARKER = new RegExp(`\\[homelab-daily:alert:(${UUID})\\]`, "i");
const UUID_ONLY = new RegExp(`^${UUID}$`, "i");

export interface CalendarEventFields {
  externalId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  kind: CalendarEventKind;
  status: CalendarEventStatus;
  etag: string | null;
  htmlLink: string | null;
  /** Ids Hermes wrote into the event; only linked if the row still exists. */
  itemRef: string | null;
  alertRef: string | null;
}

function lowerUuid(value: string | undefined): string | null {
  return value && UUID_ONLY.test(value) ? value.toLowerCase() : null;
}

/** Maps a Google event to cache fields. Returns null for cancelled stubs (they only cancel existing rows). */
export function toCalendarEventFields(event: GoogleCalendarWindowEvent, timeZone: string): CalendarEventFields | null {
  if (!event.start || !event.end) return null;

  const allDay = Boolean(event.start.date && !event.start.dateTime);
  // All-day events carry dates, not instants; pin them to local midnight (the end date is exclusive).
  const startsAt = allDay ? dayBounds(event.start.date!, timeZone).start : new Date(event.start.dateTime!);
  const endsAt = allDay
    ? dayBounds(event.end.date ?? addDays(event.start.date!, 1), timeZone).start
    : new Date(event.end.dateTime ?? event.start.dateTime!);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;

  const description = event.description ?? "";
  const itemRef = lowerUuid(event.privateProperties.homelabDailyItemId) ?? ITEM_MARKER.exec(description)?.[1]?.toLowerCase() ?? null;
  const alertRef = ALERT_MARKER.exec(description)?.[1]?.toLowerCase() ?? null;

  return {
    externalId: event.id,
    title: (event.summary ?? "(No title)").slice(0, 300),
    startsAt,
    endsAt: endsAt < startsAt ? startsAt : endsAt,
    allDay,
    kind: itemRef || alertRef ? "work_block" : "calendar",
    status: event.status,
    etag: event.etag?.slice(0, 200) ?? null,
    htmlLink: event.htmlLink,
    itemRef,
    alertRef,
  };
}
