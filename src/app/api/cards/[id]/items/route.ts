import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { createItem } from "@/lib/dashboard/user-items";
import { parseCreateItem, uuid } from "@/lib/dashboard/user-parse";

export const POST = withErrorHandling(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const cardId = uuid((await context.params).id, "id");
  const input = parseCreateItem(await readJsonBody(request));
  return Response.json(await createItem(cardId, input), { status: 201 });
});
