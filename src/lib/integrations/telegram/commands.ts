import { getProjectContext } from "@/lib/db/context";
import { listRecentEvents } from "@/lib/db/events";
import { listProjects } from "@/lib/db/projects";
import type { ContextSummary, Project, WorkEvent } from "@/types/contracts";

export const START_MESSAGE = `Welcome to Continuum! Your work, connected.

Commands:
/status — Recent project activity
/resume — Pick up where you left off
/help — Show available commands`;

export const HELP_MESSAGE = `Continuum commands:
/status — Recent project activity
/resume — Pick up where you left off
/help — Show available commands`;

export interface ContinuumReader {
  getProject(projectId: string): Promise<Project | null>;
  getRecentEvents(projectId: string): Promise<WorkEvent[]>;
  getContext(projectId: string): Promise<ContextSummary>;
}

export const continuumReader: ContinuumReader = {
  async getProject(projectId) {
    const projects = await listProjects();
    return projects.find((project) => project.id === projectId) ?? null;
  },
  getRecentEvents: (projectId) => listRecentEvents(projectId, 20),
  getContext: getProjectContext,
};

function projectNotFound(projectId: string): Error {
  return new Error(`Configured Continuum project ${projectId} was not found`);
}

function bulletItems(items: string[], empty: string): string {
  return items.length > 0 ? items.map((item) => `• ${item}`).join("\n") : empty;
}

function pullRequestStatus(events: WorkEvent[]): string[] {
  const prs = new Map<string, "open" | "merged">();
  for (const event of [...events].reverse()) {
    if (!event.action.startsWith("pr_")) continue;
    const number = typeof event.metadata.prNumber === "number"
      ? String(event.metadata.prNumber)
      : event.externalId?.match(/:pr:([^:]+)/)?.[1];
    if (!number) continue;
    const key = `${event.metadata.repository ?? "github"}:${number}`;
    if (event.action === "pr_merged") prs.set(key, "merged");
    if (event.action === "pr_opened" && !prs.has(key)) prs.set(key, "open");
  }
  return [...prs.entries()].slice(0, 5).map(([key, state]) => {
    const number = key.split(":").at(-1);
    return `PR #${number} ${state}`;
  });
}

export function formatStatus(project: Project, events: WorkEvent[]): string {
  const githubActivity = events
    .filter((event) => event.source === "github")
    .slice(0, 5)
    .map((event) => event.summary);
  const prs = pullRequestStatus(events);

  return `${project.name}
${events.length} recent events

Recent GitHub activity:
${bulletItems(githubActivity, "No recent GitHub activity.")}

Pull requests:
${bulletItems(prs, "No recent pull request activity.")}`;
}

export function formatResume(project: Project, context: ContextSummary): string {
  const section = (title: string, items: { text: string }[], empty: string) =>
    `${title}:\n${bulletItems(items.map((item) => item.text), empty)}`;

  return `${project.name} — Resume my work

${section("Completed", context.completed, "Nothing confirmed completed yet.")}

${section("In Progress", context.inProgress, "Nothing currently in progress.")}

${section("Blockers", context.blockers, "No blockers reported.")}

${section("Next Steps", context.nextSteps, "No next steps suggested yet.")}`;
}

export async function getProjectOrThrow(reader: ContinuumReader, projectId: string): Promise<Project> {
  const project = await reader.getProject(projectId);
  if (!project) throw projectNotFound(projectId);
  return project;
}

export async function buildStatusMessage(reader: ContinuumReader, projectId: string): Promise<string> {
  const [project, events] = await Promise.all([
    getProjectOrThrow(reader, projectId),
    reader.getRecentEvents(projectId),
  ]);
  return formatStatus(project, events);
}

export async function buildResumeMessage(reader: ContinuumReader, projectId: string): Promise<string> {
  const [project, context] = await Promise.all([
    getProjectOrThrow(reader, projectId),
    reader.getContext(projectId),
  ]);
  return formatResume(project, context);
}
