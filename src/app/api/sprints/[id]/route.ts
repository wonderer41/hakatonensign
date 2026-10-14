import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { parseUpdateSprint, uuid } from "@/lib/dashboard/user-parse";
import { updateSprint } from "@/lib/dashboard/user-sprints";

// { status: "active" } closes whichever other sprint was active (D8).
export const PATCH = withErrorHandling(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const id = uuid((await context.params).id, "id");
  const input = parseUpdateSprint(await readJsonBody(request));
  return Response.json(await updateSprint(id, input));
});
