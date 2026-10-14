import { withHermesAuth } from "@/lib/hermes/auth";
import { syncCalendarNow } from "@/lib/hermes/calendar";
import { parseCalendarChanged, readOptionalJsonBody } from "@/lib/hermes/parse";

// calendarId is accepted for the log line only: the dashboard syncs its configured
// GOOGLE_CALENDAR_ID either way, because Hermes may name the same calendar differently
// (its email address vs "primary").
export const POST = withHermesAuth(async (request: Request) => {
  const { calendarId } = parseCalendarChanged(await readOptionalJsonBody(request));
  if (calendarId) console.info(`[hermes] calendar changed: ${calendarId}`);
  return Response.json({ data: await syncCalendarNow() });
});
