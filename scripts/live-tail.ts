// Prints every live event (Postgres NOTIFY on the live channel) as it arrives.
// Usage: npm run live:tail   — e.g. alongside `npm run worker` and `npm run sync:calendar`.
import "dotenv/config";
import { LIVE_CHANNEL } from "@/lib/live/channel";
import { safeErrorMessage } from "@/lib/live/redact";
import { closeLiveSubscriber, subscribeLiveEvents } from "@/lib/live/subscribe";
import { dashboardTimeZone, formatClock, localDateString } from "@/lib/time/zone";

function timestamp(date: Date, timeZone: string): string {
  const seconds = String(Number(new Intl.DateTimeFormat("en-US", { timeZone, second: "numeric" }).format(date))).padStart(2, "0");
  return `${localDateString(date, timeZone)} ${formatClock(date, timeZone)}:${seconds}`;
}

function main(): void {
  const timeZone = dashboardTimeZone();
  console.log(`[live:tail] waiting for events on "${LIVE_CHANNEL}" (times in ${timeZone}, Ctrl+C to stop)`);
  subscribeLiveEvents(
    (event) => {
      const { type, ...fields } = event;
      const detail = Object.entries(fields)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ");
      console.log(`${timestamp(new Date(), timeZone)}  ${type}${detail ? `  ${detail}` : ""}`);
    },
    { onReconnect: () => console.log("[live:tail] reconnected; events sent while disconnected were missed") },
  );

  const stop = () => {
    void closeLiveSubscriber().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

try {
  main();
} catch (error) {
  console.error(`[live:tail] ${safeErrorMessage(error)}`);
  process.exit(1);
}
