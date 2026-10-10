import type {
  Project as ProjectRow,
  WorkEvent as WorkEventRow,
} from "@/generated/prisma/client";
import type { Project, WorkEvent } from "@/types/contracts";

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWorkEvent(row: WorkEventRow): WorkEvent {
  const metadata = row.metadata;
  return {
    id: row.id,
    projectId: row.projectId,
    source: row.source,
    externalId: row.externalId,
    timestamp: row.timestamp.toISOString(),
    actor: row.actor,
    action: row.action,
    summary: row.summary,
    sourceUrl: row.sourceUrl,
    metadata:
      typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
    createdAt: row.createdAt.toISOString(),
  };
}
