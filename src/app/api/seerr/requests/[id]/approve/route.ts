import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { approveSeerrRequest } from "@/lib/integrations/seerr/decisions";
import { parseSeerrDecision, parseSeerrRequestId } from "@/lib/integrations/seerr/validation";
import type { SeerrDecisionResponse } from "@/types/dashboard-contracts";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (request: Request, { params }: RouteContext) => {
  const requestId = parseSeerrRequestId((await params).id);
  const { library } = parseSeerrDecision(await readJsonBody(request));
  const target = await approveSeerrRequest(requestId, library);
  // Anime ignores the Temp | Permanent switch, so report the library it really went to.
  const body: SeerrDecisionResponse = { ok: true, library: target.kind };
  return Response.json(body);
});
