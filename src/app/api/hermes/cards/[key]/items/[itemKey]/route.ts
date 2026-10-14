import { readJsonBody } from "@/lib/api/http";
import { upsertItem } from "@/lib/dashboard/items";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseKeyParam } from "@/lib/hermes/keys";
import { parseUpsertItem } from "@/lib/hermes/parse";

// :key and :itemKey are each a key or id:<uuid>.
export const PUT = withHermesAuth(
  async (request: Request, context: { params: Promise<{ key: string; itemKey: string }> }) => {
    const params = await context.params;
    const card = parseKeyParam(params.key, "card", "key");
    const item = parseKeyParam(params.itemKey, "item", "itemKey");
    const input = parseUpsertItem(await readJsonBody(request));
    const result = await upsertItem(card, item, input);
    return Response.json(result, { status: result.created ? 201 : 200 });
  },
);
