import type { GitHubSyncResult, WorkEvent } from "@/types/contracts";
import { upsertEvent } from "@/lib/db/events";
import { assertProjectExists } from "@/lib/db/projects";
import { loadJiraConfig } from "./config";
import { fetchJiraIssues } from "./client";
import { normalizeJiraIssues } from "./normalize";

export interface JiraSyncResult extends GitHubSyncResult {
  createdEvents: WorkEvent[];
}

export async function syncJiraProject(projectId: string): Promise<JiraSyncResult> {
  await assertProjectExists(projectId);
  const config = loadJiraConfig();
  const issues = await fetchJiraIssues(config);
  const events = normalizeJiraIssues(projectId, config, issues);
  let created = 0;
  const createdEvents: WorkEvent[] = [];

  for (const event of events) {
    const result = await upsertEvent(event);
    if (result.created) {
      created += 1;
      createdEvents.push(result.event);
    }
  }

  return {
    projectId,
    repository: `jira:${config.projectKey}`,
    fetched: events.length,
    created,
    duplicates: events.length - created,
    syncedAt: new Date().toISOString(),
    createdEvents,
  };
}
