import { readJsonBody } from "@/lib/api/http";
import { upsertCard } from "@/lib/dashboard/cards";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseKeyParam } from "@/lib/hermes/keys";
import { parseUpsertCard } from "@/lib/hermes/parse";

// :key is the card's key or id:<uuid>.
export const PUT = withHermesAuth(async (request: Request, context: { params: Promise<{ key: string }> }) => {
  const card = parseKeyParam((await context.params).key, "card", "key");
  const input = parseUpsertCard(await readJsonBody(request));
  const result = await upsertCard(card, input);
  return Response.json(result, { status: result.created ? 201 : 200 });
});
