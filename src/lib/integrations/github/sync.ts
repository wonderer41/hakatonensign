import { ingestEvent } from "@/lib/db/events";
import { assertProjectExists } from "@/lib/db/projects";
import { fetchGitHubActivity } from "./client";
import { normalizeGitHubActivity } from "./normalize";
import type { GitHubSyncResult } from "@/types/contracts";

export async function syncGitHubRepository(
  projectId: string,
  owner: string,
  repo: string,
): Promise<GitHubSyncResult> {
  await assertProjectExists(projectId);
  const activity = await fetchGitHubActivity(owner, repo);
  const events = normalizeGitHubActivity(projectId, owner, repo, activity);
  let created = 0;

  for (const event of events) {
    if ((await ingestEvent(event)).created) created += 1;
  }

  return {
    projectId,
    repository: `${owner}/${repo}`,
    fetched: events.length,
    created,
    duplicates: events.length - created,
    syncedAt: new Date().toISOString(),
  };
}
