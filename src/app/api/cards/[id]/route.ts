import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { updateCard } from "@/lib/dashboard/user-cards";
import { parseUpdateCard, uuid } from "@/lib/dashboard/user-parse";

// Cards are archived with { status: "archived" }; there is no DELETE.
export const PATCH = withErrorHandling(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const id = uuid((await context.params).id, "id");
  const input = parseUpdateCard(await readJsonBody(request));
  return Response.json(await updateCard(id, input));
});
