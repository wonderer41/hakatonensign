import type { GitHubSyncRequest } from "@/types/contracts";
import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { parseUuid } from "@/lib/api/validation";
import { syncGitHubRepository } from "@/lib/integrations/github/sync";
import { HttpError } from "@/lib/api/http";

function requiredRepositoryPart(body: Record<string, unknown>, field: "owner" | "repo"): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError("VALIDATION_ERROR", `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 100 || !/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new HttpError("VALIDATION_ERROR", `${field} contains invalid characters`);
  }
  return trimmed;
}

function parseSyncRequest(body: unknown): GitHubSyncRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError("VALIDATION_ERROR", "Request body must be a JSON object");
  }
  const values = body as Record<string, unknown>;
  return {
    projectId: parseUuid(values.projectId, "projectId"),
    owner: requiredRepositoryPart(values, "owner"),
    repo: requiredRepositoryPart(values, "repo"),
  };
}

export const POST = withErrorHandling(async (request: Request) => {
  const input = parseSyncRequest(await readJsonBody(request));
  const data = await syncGitHubRepository(input.projectId, input.owner, input.repo);
  return Response.json({ data });
});
