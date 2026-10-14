import { readJsonBody } from "@/lib/api/http";
import { upsertItem } from "@/lib/dashboard/items";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseKeyParam } from "@/lib/hermes/keys";
import { parseUpsertItem } from "@/lib/hermes/parse";

export const PUT = withHermesAuth(
  async (request: Request, context: { params: Promise<{ key: string; itemKey: string }> }) => {
    const params = await context.params;
    const cardKey = parseKeyParam(params.key, "card", "key");
    const itemKey = parseKeyParam(params.itemKey, "item", "itemKey");
    const input = parseUpsertItem(await readJsonBody(request));
    const result = await upsertItem(cardKey, itemKey, input);
    return Response.json(result, { status: result.created ? 201 : 200 });
  },
);
