import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { approveSeerrRequest } from "@/lib/integrations/seerr/decisions";
import { parseSeerrDecision, parseSeerrRequestId } from "@/lib/integrations/seerr/validation";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (request: Request, { params }: RouteContext) => {
  const requestId = parseSeerrRequestId((await params).id);
  const { library } = parseSeerrDecision(await readJsonBody(request));
  await approveSeerrRequest(requestId, library);
  return Response.json({ ok: true });
});
