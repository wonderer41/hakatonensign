import type { GitHubSyncResult } from "@/types/contracts";
import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { parseUuid } from "@/lib/api/validation";
import { syncJiraProject } from "@/lib/integrations/jira/sync";

export const POST = withErrorHandling(async (request: Request) => {
  const body = await readJsonBody(request);
  const projectId = typeof body === "object" && body !== null && !Array.isArray(body)
    ? parseUuid((body as Record<string, unknown>).projectId, "projectId")
    : parseUuid(null, "projectId");
  const result = await syncJiraProject(projectId);
  const data: GitHubSyncResult = {
    projectId: result.projectId,
    repository: result.repository,
    fetched: result.fetched,
    created: result.created,
    duplicates: result.duplicates,
    syncedAt: result.syncedAt,
  };
  return Response.json({ data });
});
