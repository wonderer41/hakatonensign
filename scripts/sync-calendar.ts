// Runs one Google Calendar sync into the CalendarEvent cache, publishes timeline.changed for the
// affected dates (the same run as the worker's calendar-sync job) and prints the resulting timeline.
// Usage: npm run sync:calendar [-- --date YYYY-MM-DD]
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { NOW_MARKER_ID } from "@/lib/timeline/build";
import { getTimeline } from "@/lib/timeline/query";
import { dashboardTimeZone, formatClock, isDateString, localDateString } from "@/lib/time/zone";
import { runCalendarSync } from "@/lib/worker/jobs";

function dateArgument(): string | null {
  const index = process.argv.indexOf("--date");
  if (index === -1) return null;
  const value = process.argv[index + 1] ?? "";
  if (!isDateString(value)) throw new Error("--date must be a YYYY-MM-DD calendar date");
  return value;
}

function formatGap(minutes: number): string {
  if (minutes < 0) return "overlap";
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m free` : `${minutes}m free`;
}

async function main(): Promise<void> {
  const timeZone = dashboardTimeZone();
  const now = new Date();
  const date = dateArgument() ?? localDateString(now, timeZone);

  const { sync, publishedDates } = await runCalendarSync(now);
  console.log(`Calendar sync · ${sync.calendarId}`);
  const lastDay = localDateString(new Date(new Date(sync.window.end).getTime() - 1), timeZone);
  console.log(`  window     ${localDateString(new Date(sync.window.start), timeZone)} → ${lastDay} (${timeZone})`);
  console.log(`  fetched ${sync.fetched} · created ${sync.created} · updated ${sync.updated} · cancelled ${sync.cancelled} · unchanged ${sync.unchanged}`);
  if (!sync.complete) console.log("  warning    Google had more events than one sync reads; deleted events were not cancelled this run");
  if (sync.changedDates.length) console.log(`  changed    ${sync.changedDates.join(", ")}`);
  if (publishedDates.length) console.log(`  published  timeline.changed for ${publishedDates.join(", ")}`);

  const timeline = await getTimeline(date, now);
  console.log(`\nTimeline · ${timeline.date} (${timeline.timeZone})`);
  for (const event of timeline.allDay) console.log(`  all day       ${event.title}`);

  const gapAfter = new Map(timeline.gaps.map((gap) => [gap.afterEventId, gap]));
  const cards: { id: string; line: string }[] = timeline.events.map((event) => {
    const time = `${formatClock(new Date(event.startsAt), timeZone)}–${formatClock(new Date(event.endsAt), timeZone)}`;
    const label = event.kind === "work_block" ? "via hermes" : event.state === "past" ? "done" : event.state === "current" ? "now" : "calendar";
    return { id: event.id, line: `  ${time}   ${event.title}  · ${label}` };
  });
  if (localDateString(new Date(timeline.now), timeZone) === timeline.date) {
    const nowMs = new Date(timeline.now).getTime();
    const index = timeline.events.findIndex((event) => new Date(event.startsAt).getTime() >= nowMs);
    cards.splice(index === -1 ? cards.length : index, 0, { id: NOW_MARKER_ID, line: `  ${formatClock(new Date(timeline.now), timeZone)}         ── now ──` });
  }
  if (cards.length === 0) console.log("  (no timed events)");
  for (const card of cards) {
    console.log(card.line);
    const gap = gapAfter.get(card.id);
    if (gap && card !== cards[cards.length - 1]) console.log(`                ↳ ${formatGap(gap.minutes)}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
