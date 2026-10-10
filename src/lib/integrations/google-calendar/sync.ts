import { upsertEvent } from "@/lib/db/events";
import { assertProjectExists } from "@/lib/db/projects";
import type { WorkEvent } from "@/types/contracts";
import { loadGoogleCalendarConfig } from "./config";
import { fetchGoogleCalendarEvents } from "./client";
import { normalizeGoogleCalendarEvents } from "./normalize";

export interface GoogleCalendarSyncResult {
  projectId: string;
  calendarId: string;
  fetched: number;
  created: number;
  duplicates: number;
  syncedAt: string;
  createdEvents: WorkEvent[];
}

export async function syncGoogleCalendar(projectId: string): Promise<GoogleCalendarSyncResult> {
  await assertProjectExists(projectId);
  const config = loadGoogleCalendarConfig();
  const apiEvents = await fetchGoogleCalendarEvents(config);
  const events = normalizeGoogleCalendarEvents(projectId, config, apiEvents);
  let created = 0;
  const createdEvents: WorkEvent[] = [];

  for (const event of events) {
    const result = await upsertEvent(event);
    if (result.created) {
      created += 1;
      createdEvents.push(result.event);
    }
  }

  return {
    projectId,
    calendarId: config.calendarId,
    fetched: events.length,
    created,
    duplicates: events.length - created,
    syncedAt: new Date().toISOString(),
    createdEvents,
  };
}
