import type { GoogleCalendarApiEvent } from "./client";
import type { GoogleCalendarConfig } from "./config";
import type { ValidatedEventInput } from "@/lib/api/validation";

function eventTime(value: { date?: string; dateTime?: string }): { value: string; allDay: boolean } {
  if (value.dateTime) {
    const parsed = new Date(value.dateTime);
    if (Number.isNaN(parsed.getTime())) throw new Error("Google Calendar event has an invalid date-time");
    return { value: parsed.toISOString(), allDay: false };
  }
  if (value.date) return { value: `${value.date}T00:00:00.000Z`, allDay: true };
  throw new Error("Google Calendar event is missing a start or end time");
}

function person(event: GoogleCalendarApiEvent): string {
  return event.organizer?.displayName?.trim() || event.organizer?.email?.trim() || event.creator?.displayName?.trim() || event.creator?.email?.trim() || "google-calendar";
}

export function normalizeGoogleCalendarEvent(projectId: string, config: GoogleCalendarConfig, event: GoogleCalendarApiEvent): ValidatedEventInput {
  const start = eventTime(event.start);
  const end = eventTime(event.end);
  const title = event.summary?.trim() || "Untitled calendar event";
  return {
    projectId,
    source: "google_calendar",
    externalId: `google-calendar:${config.calendarId}:${event.id}`,
    timestamp: start.value,
    actor: person(event),
    action: "task_updated",
    summary: `Calendar: ${title}`,
    sourceUrl: event.htmlLink,
    metadata: {
      calendarId: config.calendarId,
      calendarEventId: event.id,
      title,
      description: event.description,
      status: event.status,
      start: start.value,
      end: end.value,
      startDate: event.start.date ?? null,
      endDate: event.end.date ?? null,
      timeZone: event.start.timeZone ?? event.end.timeZone ?? config.timeZone,
      recurringEventId: event.recurringEventId,
      recurrence: event.recurrence,
      createdAt: event.created,
      updatedAt: event.updated,
    },
  };
}

export function normalizeGoogleCalendarEvents(projectId: string, config: GoogleCalendarConfig, events: GoogleCalendarApiEvent[]): ValidatedEventInput[] {
  return events.map((event) => normalizeGoogleCalendarEvent(projectId, config, event));
}
