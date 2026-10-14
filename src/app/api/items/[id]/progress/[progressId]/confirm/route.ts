import { withErrorHandling } from "@/lib/api/http";
import { parseProgressParams, resolveItemProgress } from "@/lib/dashboard/progress";
import { parseNoInput, readOptionalJsonBody } from "@/lib/hermes/parse";

type RouteContext = { params: Promise<{ id: string; progressId: string }> };

// D7: Gerardo accepts a push note. looks_done also checks the item. Returns the ChecklistItemDto.
export const POST = withErrorHandling(async (request: Request, { params }: RouteContext) => {
  const { itemId, progressId } = parseProgressParams(await params);
  parseNoInput(await readOptionalJsonBody(request));
  return Response.json(await resolveItemProgress(itemId, progressId, "confirm"));
});
