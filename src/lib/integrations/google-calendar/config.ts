import { HttpError } from "@/lib/api/http";

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  timeZone: string | null;
  pastDays: number;
  futureDays: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (!value) throw new HttpError("UPSTREAM_ERROR", `${name} is not configured`);
  return value;
}

function days(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 365) {
    throw new HttpError("UPSTREAM_ERROR", `${name} must be an integer between 0 and 365`);
  }
  return value;
}

export function loadGoogleCalendarConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleCalendarConfig {
  const calendarId = required(env, "GOOGLE_CALENDAR_ID");
  const timeZone = env.GOOGLE_CALENDAR_TIME_ZONE?.trim() || null;
  return {
    clientId: required(env, "GOOGLE_CLIENT_ID"),
    clientSecret: required(env, "GOOGLE_CLIENT_SECRET"),
    refreshToken: required(env, "GOOGLE_REFRESH_TOKEN"),
    calendarId,
    timeZone,
    pastDays: days(env, "GOOGLE_CALENDAR_PAST_DAYS", 30),
    futureDays: days(env, "GOOGLE_CALENDAR_FUTURE_DAYS", 90),
  };
}
