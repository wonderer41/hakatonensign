import { readJsonBody } from "@/lib/api/http";
import { localDate } from "@/lib/api/validate";
import { setDailyMessage } from "@/lib/dashboard/banner";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseDailyMessage } from "@/lib/hermes/parse";

// D13: Hermes writes the daily message each morning.
export const PUT = withHermesAuth(async (request: Request, context: { params: Promise<{ date: string }> }) => {
  const date = localDate((await context.params).date, "date");
  const { text } = parseDailyMessage(await readJsonBody(request));
  const result = await setDailyMessage(date, text, "hermes");
  return Response.json(result, { status: result.created ? 201 : 200 });
});
