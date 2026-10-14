import { readJsonBody } from "@/lib/api/http";
import { upsertAlert } from "@/lib/dashboard/alerts";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseDedupeKeyParam } from "@/lib/hermes/keys";
import { parseUpsertAlert } from "@/lib/hermes/parse";

export const PUT = withHermesAuth(async (request: Request, context: { params: Promise<{ dedupeKey: string }> }) => {
  const dedupeKey = parseDedupeKeyParam((await context.params).dedupeKey, "dedupeKey");
  const input = parseUpsertAlert(await readJsonBody(request));
  const result = await upsertAlert(dedupeKey, input);
  return Response.json(result, { status: result.created ? 201 : 200 });
});
