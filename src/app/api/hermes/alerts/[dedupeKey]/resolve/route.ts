import { resolveAlert } from "@/lib/dashboard/alerts";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseDedupeKeyParam } from "@/lib/hermes/keys";
import { parseNoInput, readOptionalJsonBody } from "@/lib/hermes/parse";

export const POST = withHermesAuth(async (request: Request, context: { params: Promise<{ dedupeKey: string }> }) => {
  const dedupeKey = parseDedupeKeyParam((await context.params).dedupeKey, "dedupeKey");
  parseNoInput(await readOptionalJsonBody(request));
  return Response.json(await resolveAlert(dedupeKey));
});
