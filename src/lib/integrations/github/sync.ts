import { ingestEvent } from "@/lib/db/events";
import { assertProjectExists } from "@/lib/db/projects";
import { fetchGitHubActivity } from "./client";
import { normalizeGitHubActivity } from "./normalize";
import type { GitHubSyncResult, WorkEvent } from "@/types/contracts";

export interface GitHubSyncRunResult extends GitHubSyncResult {
  createdEvents: WorkEvent[];
}

export async function syncGitHubRepository(
  projectId: string,
  owner: string,
  repo: string,
): Promise<GitHubSyncRunResult> {
  await assertProjectExists(projectId);
  const activity = await fetchGitHubActivity(owner, repo);
  const events = normalizeGitHubActivity(projectId, owner, repo, activity);
  let created = 0;
  const createdEvents: WorkEvent[] = [];

  for (const event of events) {
    const result = await ingestEvent(event);
    if (result.created) {
      created += 1;
      createdEvents.push(result.event);
    }
  }

  return {
    projectId,
    repository: `${owner}/${repo}`,
    fetched: events.length,
    created,
    duplicates: events.length - created,
    syncedAt: new Date().toISOString(),
    createdEvents,
  };
}
