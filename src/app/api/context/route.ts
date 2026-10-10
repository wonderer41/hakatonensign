import { withErrorHandling } from "@/lib/api/http";
import { parseUuid } from "@/lib/api/validation";
import { getProjectContext } from "@/lib/db/context";

export const GET = withErrorHandling(async (request: Request) => {
  const projectId = parseUuid(
    new URL(request.url).searchParams.get("projectId"),
    "projectId",
  );
  const data = await getProjectContext(projectId);
  return Response.json({ data });
});
