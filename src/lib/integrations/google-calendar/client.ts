import { HttpError } from "@/lib/api/http";
import type { GoogleCalendarConfig } from "./config";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const PAGE_SIZE = 250;

interface CalendarListResponse {
  items?: unknown;
  nextPageToken?: unknown;
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

// Google access tokens last an hour. Reuse one until a minute before it expires instead of asking the
// token endpoint on every sync (720 times a day at one sync every 2 minutes, about 24 with reuse).
const TOKEN_REUSE_MARGIN_MS = 60_000;

let cachedToken: { key: string; value: string; expiresAt: number } | null = null;

function tokenKey(config: GoogleCalendarConfig): string {
  return `${config.clientId}\n${config.refreshToken}`;
}

/** Drops the reused token after Google rejected it, so the next call fetches a fresh one. */
function forgetAccessToken(token: string): void {
  if (cachedToken?.value === token) cachedToken = null;
}

async function accessToken(config: GoogleCalendarConfig): Promise<string> {
  const key = tokenKey(config);
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.value;

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
  const expiresInMs = typeof payload.expires_in === "number" ? payload.expires_in * 1000 : 0;
  const expiresAt = Date.now() + expiresInMs - TOKEN_REUSE_MARGIN_MS;
  cachedToken = expiresAt > Date.now() ? { key, value: payload.access_token, expiresAt } : null;
  return payload.access_token;
}

/** One page of events, or null when Google rejected the access token (401). */
async function fetchPage(
  config: GoogleCalendarConfig,
  token: string,
  timeMin: string,
  timeMax: string,
  pageToken?: string,
): Promise<CalendarListResponse | null> {
  const params = new URLSearchParams({
    calendarId: config.calendarId,
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    // Cancelled events must come back so the cache can mark them cancelled.
    showDeleted: "true",
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
  if (response.status === 401) return null;
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

/** fetchPage with the reused token; if Google rejects it (revoked or expired early), retries once with a fresh one. */
async function fetchPageAuthorized(
  config: GoogleCalendarConfig,
  timeMin: string,
  timeMax: string,
  pageToken?: string,
): Promise<CalendarListResponse> {
  const token = await accessToken(config);
  const page = await fetchPage(config, token, timeMin, timeMax, pageToken);
  if (page) return page;

  forgetAccessToken(token);
  const retry = await fetchPage(config, await accessToken(config), timeMin, timeMax, pageToken);
  if (!retry) throw new HttpError("UNAUTHORIZED", "Google Calendar API request failed with status 401");
  return retry;
}

// ---------- Timeline window (CalendarEvent cache) ----------

const MAX_WINDOW_PAGES = 20;

export type GoogleEventStatus = "confirmed" | "tentative" | "cancelled";

export interface GoogleCalendarWindowEvent {
  id: string;
  status: GoogleEventStatus;
  summary: string | null;
  description: string | null;
  htmlLink: string | null;
  etag: string | null;
  /** Null only for cancelled stubs, which Google may send without times. */
  start: { date?: string; dateTime?: string } | null;
  end: { date?: string; dateTime?: string } | null;
  /** extendedProperties.private, where Hermes stores homelabDailyItemId. */
  privateProperties: Record<string, string>;
}

export interface GoogleCalendarWindow {
  events: GoogleCalendarWindowEvent[];
  /** False when the page cap was hit; callers must not treat missing events as deleted. */
  complete: boolean;
}

function parseWhen(value: unknown): { date?: string; dateTime?: string } | null {
  if (!isRecord(value)) return null;
  const date = stringOrNull(value.date) ?? undefined;
  const dateTime = stringOrNull(value.dateTime) ?? undefined;
  return date || dateTime ? { date, dateTime } : null;
}

function parseWindowEvent(value: unknown): GoogleCalendarWindowEvent {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) {
    throw new HttpError("UPSTREAM_ERROR", "Google Calendar returned a malformed event");
  }
  const status: GoogleEventStatus =
    value.status === "cancelled" ? "cancelled" : value.status === "tentative" ? "tentative" : "confirmed";
  const start = parseWhen(value.start);
  const end = parseWhen(value.end);
  if (status !== "cancelled" && (!start || !end)) {
    throw new HttpError("UPSTREAM_ERROR", "Google Calendar returned an event without start or end");
  }
  const privateProperties: Record<string, string> = {};
  const extended = isRecord(value.extendedProperties) ? value.extendedProperties : null;
  if (extended && isRecord(extended.private)) {
    for (const [key, raw] of Object.entries(extended.private)) {
      if (typeof raw === "string") privateProperties[key] = raw;
    }
  }
  return {
    id: value.id,
    status,
    summary: stringOrNull(value.summary),
    description: stringOrNull(value.description),
    htmlLink: stringOrNull(value.htmlLink),
    etag: stringOrNull(value.etag),
    start,
    end,
    privateProperties,
  };
}

/** Every event overlapping [timeMin, timeMax), including cancelled ones, with recurring events expanded. */
export async function fetchGoogleCalendarWindow(
  config: GoogleCalendarConfig,
  timeMin: Date,
  timeMax: Date,
): Promise<GoogleCalendarWindow> {
  const events: GoogleCalendarWindowEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_WINDOW_PAGES; page += 1) {
    const response = await fetchPageAuthorized(config, timeMin.toISOString(), timeMax.toISOString(), pageToken);
    if (!Array.isArray(response.items)) throw new HttpError("UPSTREAM_ERROR", "Google Calendar returned an invalid event list");
    events.push(...response.items.map(parseWindowEvent));
    if (typeof response.nextPageToken !== "string") return { events, complete: true };
    pageToken = response.nextPageToken;
  }
  return { events, complete: false };
}
