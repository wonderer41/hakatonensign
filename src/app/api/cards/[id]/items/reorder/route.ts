import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { reorderItems } from "@/lib/dashboard/user-items";
import { parseReorder, uuid } from "@/lib/dashboard/user-parse";

export const POST = withErrorHandling(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const cardId = uuid((await context.params).id, "id");
  const { ids } = parseReorder(await readJsonBody(request));
  return Response.json({ data: await reorderItems(cardId, ids) });
});
