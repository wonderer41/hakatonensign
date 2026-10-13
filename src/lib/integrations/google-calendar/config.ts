import { HttpError } from "@/lib/api/http";

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (!value) throw new HttpError("UPSTREAM_ERROR", `${name} is not configured`);
  return value;
}

export function loadGoogleCalendarConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleCalendarConfig {
  const calendarId = required(env, "GOOGLE_CALENDAR_ID");
  return {
    clientId: required(env, "GOOGLE_CLIENT_ID"),
    clientSecret: required(env, "GOOGLE_CLIENT_SECRET"),
    refreshToken: required(env, "GOOGLE_REFRESH_TOKEN"),
    calendarId,
  };
}
