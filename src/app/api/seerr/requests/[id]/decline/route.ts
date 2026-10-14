import { withErrorHandling } from "@/lib/api/http";
import { declineSeerrRequest } from "@/lib/integrations/seerr/decisions";
import { parseEmptyBody, parseSeerrRequestId } from "@/lib/integrations/seerr/validation";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (request: Request, { params }: RouteContext) => {
  const requestId = parseSeerrRequestId((await params).id);
  parseEmptyBody(await request.text());
  await declineSeerrRequest(requestId);
  return Response.json({ ok: true });
});
