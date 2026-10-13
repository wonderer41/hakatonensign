import { HttpError, withErrorHandling } from "@/lib/api/http";
import { dashboardTimeZone, isDateString, localDateString } from "@/lib/time/zone";
import { getTimeline } from "@/lib/timeline/query";

export const GET = withErrorHandling(async (request: Request) => {
  const param = new URL(request.url).searchParams.get("date");
  if (param !== null && !isDateString(param)) {
    throw new HttpError("VALIDATION_ERROR", "date must be a YYYY-MM-DD calendar date", { field: "date" });
  }
  const now = new Date();
  const date = param ?? localDateString(now, dashboardTimeZone());
  return Response.json(await getTimeline(date, now));
});
