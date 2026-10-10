import type { ContextSummary } from "@/types/contracts";
import { buildRulesContext } from "@/lib/context/rules";
import { listRecentEvents } from "./events";
import { assertProjectExists } from "./projects";
import { prisma } from "./prisma";

// How many recent events the summary looks at.
const CONTEXT_WINDOW = 200;

// Shared by GET /api/context and the Telegram /resume command.
export async function getProjectContext(projectId: string): Promise<ContextSummary> {
  await assertProjectExists(projectId);
  const [events, activityCount] = await Promise.all([
    listRecentEvents(projectId, CONTEXT_WINDOW),
    prisma.workEvent.count({ where: { projectId } }),
  ]);
  return buildRulesContext(projectId, events, activityCount);
}
