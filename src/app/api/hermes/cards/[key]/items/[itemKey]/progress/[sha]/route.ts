import { readJsonBody } from "@/lib/api/http";
import { upsertItemProgress } from "@/lib/dashboard/progress";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseKeyParam } from "@/lib/hermes/keys";
import { parseCommitSha, parseItemProgress } from "@/lib/hermes/parse";

// D7: one note per push per item. :key and :itemKey are each a key or id:<uuid>.
export const PUT = withHermesAuth(
  async (request: Request, context: { params: Promise<{ key: string; itemKey: string; sha: string }> }) => {
    const params = await context.params;
    const card = parseKeyParam(params.key, "card", "key");
    const item = parseKeyParam(params.itemKey, "item", "itemKey");
    const sha = parseCommitSha(params.sha);
    const input = parseItemProgress(await readJsonBody(request));
    const result = await upsertItemProgress(card, item, sha, input);
    return Response.json(result, { status: result.created ? 201 : 200 });
  },
);
