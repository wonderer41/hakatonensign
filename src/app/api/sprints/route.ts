import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { parseCreateSprint, parseSprintQuery } from "@/lib/dashboard/user-parse";
import { createSprint, listSprints } from "@/lib/dashboard/user-sprints";

export const GET = withErrorHandling(async (request: Request) => {
  const { status } = parseSprintQuery(new URL(request.url).searchParams);
  return Response.json({ data: await listSprints(status) });
});

export const POST = withErrorHandling(async (request: Request) => {
  const input = parseCreateSprint(await readJsonBody(request));
  return Response.json(await createSprint(input), { status: 201 });
});
