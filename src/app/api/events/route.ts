import type { CreateEventResponse } from "@/types/contracts";
import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { parseCreateEvent, parseLimit, parseUuid } from "@/lib/api/validation";
import { ingestEvent, listEvents } from "@/lib/db/events";

export const GET = withErrorHandling(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const projectId = parseUuid(params.get("projectId"), "projectId");
  const limit = parseLimit(params.get("limit"), 50, 100);
  const page = await listEvents(projectId, limit, params.get("cursor"));
  return Response.json(page);
});

export const POST = withErrorHandling(async (request: Request) => {
  const input = parseCreateEvent(await readJsonBody(request));
  const { event, created } = await ingestEvent(input);
  const body: CreateEventResponse = { data: event, created };
  return Response.json(body, { status: created ? 201 : 200 });
});
