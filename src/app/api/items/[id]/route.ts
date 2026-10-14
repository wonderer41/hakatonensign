import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { updateItem } from "@/lib/dashboard/user-items";
import { parseUpdateItem, uuid } from "@/lib/dashboard/user-parse";

// The checklist checkbox ({ done }) and "make this the current item" ({ isCurrent: true }).
export const PATCH = withErrorHandling(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const id = uuid((await context.params).id, "id");
  const input = parseUpdateItem(await readJsonBody(request));
  return Response.json(await updateItem(id, input));
});
