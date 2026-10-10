import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { parseUpdateProject, parseUuid } from "@/lib/api/validation";
import { deleteProject, updateProject } from "@/lib/db/projects";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const projectId = parseUuid(id, "id");
  const input = parseUpdateProject(await readJsonBody(request));
  const data = await updateProject(projectId, input);
  return Response.json({ data });
});

export const DELETE = withErrorHandling(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  await deleteProject(parseUuid(id, "id"));
  return new Response(null, { status: 204 });
});
