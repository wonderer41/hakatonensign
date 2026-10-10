import { HttpError } from "@/lib/api/http";
import type { GoogleCalendarConfig } from "./config";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const PAGE_SIZE = 250;
const MAX_EVENTS = 1_000;

interface CalendarListResponse {
  items?: unknown;
  nextPageToken?: unknown;
}

export interface GoogleCalendarApiEvent {
  id: string;
  status: string | null;
  summary: string | null;
  description: string | null;
  htmlLink: string | null;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  created: string | null;
  updated: string | null;
  organizer: { displayName?: string; email?: string } | null;
  creator: { displayName?: string; email?: string } | null;
  recurrence: string[] | null;
  recurringEventId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function responseCode(status: number): "UNAUTHORIZED" | "RATE_LIMITED" | "UPSTREAM_ERROR" {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 429) return "RATE_LIMITED";
  return "UPSTREAM_ERROR";
}

async function accessToken(config: GoogleCalendarConfig): Promise<string> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
  } catch {
    throw new HttpError("UPSTREAM_ERROR", "Google OAuth token endpoint could not be reached");
  }

  if (!response.ok) {
    throw new HttpError(responseCode(response.status), "Google OAuth token refresh failed");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError("UPSTREAM_ERROR", "Google OAuth returned invalid JSON");
  }
  if (!isRecord(payload) || typeof payload.access_token !== "string" || !payload.access_token) {
    throw new HttpError("UPSTREAM_ERROR", "Google OAuth returned no access token");
  }
  return payload.access_token;
}

function parseEvent(value: unknown): GoogleCalendarApiEvent {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.start) || !isRecord(value.end)) {
    throw new HttpError("UPSTREAM_ERROR", "Google Calendar returned a malformed event");
  }
  const organizer = isRecord(value.organizer)
    ? { displayName: stringOrNull(value.organizer.displayName) ?? undefined, email: stringOrNull(value.organizer.email) ?? undefined }
    : null;
  const creator = isRecord(value.creator)
    ? { displayName: stringOrNull(value.creator.displayName) ?? undefined, email: stringOrNull(value.creator.email) ?? undefined }
    : null;
  return {
    id: value.id,
    status: stringOrNull(value.status),
    summary: stringOrNull(value.summary),
    description: stringOrNull(value.description),
    htmlLink: stringOrNull(value.htmlLink),
    start: {
      date: stringOrNull(value.start.date) ?? undefined,
      dateTime: stringOrNull(value.start.dateTime) ?? undefined,
      timeZone: stringOrNull(value.start.timeZone) ?? undefined,
    },
    end: {
      date: stringOrNull(value.end.date) ?? undefined,
      dateTime: stringOrNull(value.end.dateTime) ?? undefined,
      timeZone: stringOrNull(value.end.timeZone) ?? undefined,
    },
    created: stringOrNull(value.created),
    updated: stringOrNull(value.updated),
    organizer,
    creator,
    recurrence: Array.isArray(value.recurrence) ? value.recurrence.filter((item): item is string => typeof item === "string") : null,
    recurringEventId: stringOrNull(value.recurringEventId),
  };
}

async function fetchPage(
  config: GoogleCalendarConfig,
  token: string,
  timeMin: string,
  timeMax: string,
  pageToken?: string,
): Promise<CalendarListResponse> {
  const params = new URLSearchParams({
    calendarId: config.calendarId,
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    showDeleted: "false",
    maxResults: String(PAGE_SIZE),
  });
  if (pageToken) params.set("pageToken", pageToken);

  let response: Response;
  try {
    response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(config.calendarId)}/events?${params.toString()}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    throw new HttpError("UPSTREAM_ERROR", "Google Calendar API could not be reached");
  }
  if (!response.ok) throw new HttpError(responseCode(response.status), `Google Calendar API request failed with status ${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError("UPSTREAM_ERROR", "Google Calendar returned invalid JSON");
  }
  if (!isRecord(payload)) throw new HttpError("UPSTREAM_ERROR", "Google Calendar returned an invalid response");
  return payload as CalendarListResponse;
}

export async function fetchGoogleCalendarEvents(config: GoogleCalendarConfig, now = new Date()): Promise<GoogleCalendarApiEvent[]> {
  const timeMin = new Date(now.getTime() - config.pastDays * 86_400_000).toISOString();
  const timeMax = new Date(now.getTime() + config.futureDays * 86_400_000).toISOString();
  const token = await accessToken(config);
  const events: GoogleCalendarApiEvent[] = [];
  let pageToken: string | undefined;

  while (events.length < MAX_EVENTS) {
    const page = await fetchPage(config, token, timeMin, timeMax, pageToken);
    if (!Array.isArray(page.items)) throw new HttpError("UPSTREAM_ERROR", "Google Calendar returned an invalid event list");
    events.push(...page.items.map(parseEvent));
    if (typeof page.nextPageToken !== "string" || page.items.length === 0) break;
    pageToken = page.nextPageToken;
  }
  return events.slice(0, MAX_EVENTS).filter((event) => event.status !== "cancelled");
}

export async function verifyGoogleCalendarConnection(config: GoogleCalendarConfig): Promise<void> {
  await fetchGoogleCalendarEvents(config, new Date());
}
