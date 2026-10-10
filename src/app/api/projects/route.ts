import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { parseCreateProject, parseUuid } from "@/lib/api/validation";
import { createProject, listProjects } from "@/lib/db/projects";

export const GET = withErrorHandling(async (request: Request) => {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  const data = await listProjects(
    workspaceId === null ? undefined : parseUuid(workspaceId, "workspaceId"),
  );
  return Response.json({ data });
});

export const POST = withErrorHandling(async (request: Request) => {
  const input = parseCreateProject(await readJsonBody(request));
  const data = await createProject(input);
  return Response.json({ data }, { status: 201 });
});
