const DEFAULT_TIME_ZONE = "America/Denver";

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
