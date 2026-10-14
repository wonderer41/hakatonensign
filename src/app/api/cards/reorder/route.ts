import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { reorderCards } from "@/lib/dashboard/user-cards";
import { parseReorder } from "@/lib/dashboard/user-parse";

export const POST = withErrorHandling(async (request: Request) => {
  const { ids } = parseReorder(await readJsonBody(request));
  return Response.json({ data: await reorderCards(ids) });
});
