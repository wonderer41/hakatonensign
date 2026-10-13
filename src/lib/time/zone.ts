const DEFAULT_TIME_ZONE = "America/Denver";
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The zone that defines "today" and every day boundary on the dashboard. */
export function dashboardTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const zone = env.DASHBOARD_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new Error(`DASHBOARD_TIME_ZONE "${zone}" is not a valid IANA time zone`);
  }
  return zone;
}

/** e.g. "MONDAY · OCTOBER 12" in the dashboard time zone. */
export function formatEyebrowDate(date: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date);
  const monthDay = new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric" }).format(date);
  return `${weekday} · ${monthDay}`.toUpperCase();
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateParts(value: string): { year: number; month: number; day: number } {
  if (!isDateString(value)) throw new Error(`"${value}" is not a YYYY-MM-DD date`);
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

/** Calendar arithmetic on YYYY-MM-DD strings (no time zone involved). */
export function addDays(value: string, days: number): string {
  const { year, month, day } = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

// Milliseconds to add to UTC to get the zone's wall clock at that instant (Denver in winter: -7h).
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - wholeSeconds;
}

/** The instant when the zone's wall clock shows `minutes` past midnight on `value`. */
export function zonedTimeToUtc(value: string, minutes: number, timeZone: string): Date {
  const { year, month, day } = dateParts(value);
  const wallClock = Date.UTC(year, month - 1, day, 0, minutes);
  const firstOffset = zoneOffsetMs(new Date(wallClock), timeZone);
  const secondOffset = zoneOffsetMs(new Date(wallClock - firstOffset), timeZone);
  return new Date(wallClock - secondOffset);
}

/** A local day as [start, end) instants; DST days are 23 or 25 hours long. */
export function dayBounds(value: string, timeZone: string): { start: Date; end: Date } {
  return { start: zonedTimeToUtc(value, 0, timeZone), end: zonedTimeToUtc(addDays(value, 1), 0, timeZone) };
}

/** The local calendar date of an instant, as YYYY-MM-DD. */
export function localDateString(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Local wall-clock time of an instant, as HH:MM. */
export function formatClock(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Every local date that [start, end) touches, capped so a runaway range stays cheap. */
export function datesSpanned(start: Date, end: Date, timeZone: string, max = 31): string[] {
  const first = localDateString(start, timeZone);
  const last = localDateString(new Date(Math.max(start.getTime(), end.getTime() - 1)), timeZone);
  const dates = [first];
  while (dates[dates.length - 1] < last && dates.length < max) dates.push(addDays(dates[dates.length - 1], 1));
  return dates;
}
