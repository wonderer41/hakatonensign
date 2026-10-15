import { HttpError, withErrorHandling } from "@/lib/api/http";
import { getToday } from "@/lib/dashboard/today";
import { dashboardTimeZone, isDateString, localDateString } from "@/lib/time/zone";

// One call renders the page. `date` defaults to today in DASHBOARD_TIME_ZONE.
export const GET = withErrorHandling(async (request: Request) => {
  const param = new URL(request.url).searchParams.get("date");
  if (param !== null && !isDateString(param)) {
    throw new HttpError("VALIDATION_ERROR", "date must be a YYYY-MM-DD calendar date", { field: "date" });
  }
  const now = new Date();
  const date = param ?? localDateString(now, dashboardTimeZone());
  return Response.json(await getToday(date, now));
});
