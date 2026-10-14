import { formatClock, localDateString } from "@/lib/time/zone";

// Small, pure helpers for the Hermes scheduling bubble. Times are local wall-clock minutes after
// midnight (0–1440) on the page's date, in the dashboard time zone.

export const DAY_MINUTES = 24 * 60;
export const MIN_LENGTH = 1;
export const MAX_LENGTH = 720;

/** 1140 → "19:00". Values past midnight keep counting (1470 → "24:30"), like the mockup's echo. */
export function clockFromMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** "19:00" (or "19:00:30" from a time input with seconds) → 1140; anything else → null. */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** The length field is a free number; it is rounded to whole minutes. Empty or not a number → null. */
export function parseLength(value: string): number | null {
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

/** Readable echo of a length: 47 → "47 min", 60 → "1 h", 83 → "1 h 23 min"; nothing for ≤ 0. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null || !(minutes > 0)) return "";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""}`;
}

/**
 * Local wall-clock minutes of an instant on `date`: before that day → 0, after it → 1440.
 * Uses the wall clock, so DST days still map 19:00 to 1140.
 */
export function wallMinutes(iso: string, date: string, timeZone: string): number {
  const instant = new Date(iso);
  const day = localDateString(instant, timeZone);
  if (day < date) return 0;
  if (day > date) return DAY_MINUTES;
  return parseClock(formatClock(instant, timeZone)) ?? 0;
}

/** "HH:MM" from a server value that is either already "HH:MM" or an ISO instant. */
export function clockFromServer(value: string, timeZone: string): string {
  const minutes = parseClock(value);
  if (minutes !== null) return clockFromMinutes(minutes);
  return formatClock(new Date(value), timeZone);
}

/** "19:00–20:30" for an ISO range in the dashboard zone. */
export function formatRange(startsAt: string, endsAt: string, timeZone: string): string {
  return `${formatClock(new Date(startsAt), timeZone)}–${formatClock(new Date(endsAt), timeZone)}`;
}
