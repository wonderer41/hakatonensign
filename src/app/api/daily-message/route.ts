import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { setDailyMessage } from "@/lib/dashboard/banner";
import { parseDailyMessageBody } from "@/lib/dashboard/user-parse";

// The banner's daily message written from the page (author "user"). Hermes writes the same row
// with PUT /api/hermes/daily-message/:date (D13); the latest write wins.
export const PUT = withErrorHandling(async (request: Request) => {
  const { date, text } = parseDailyMessageBody(await readJsonBody(request));
  const { data } = await setDailyMessage(date, text, "user");
  return Response.json(data);
});
