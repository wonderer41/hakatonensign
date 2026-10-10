import { getProjectContext } from "@/lib/db/context";
import { listRecentEvents } from "@/lib/db/events";
import { listProjects } from "@/lib/db/projects";
import { aggregateProjectAiContext, type ProjectAiContext } from "@/lib/ai/context";
import { answerProjectQuestion } from "@/lib/ai/service";
import { isSafeExternalUrl } from "@/lib/ai/safety";
import type { AiContextResponse, AiMode, ContextSummary, Project, WorkEvent } from "@/types/contracts";

export const START_MESSAGE = `Welcome to Continuum! Your work, connected.

Commands:
/status — Recent project activity
/resume — Pick up where you left off
/help — Show available commands`;

export const HELP_MESSAGE = `Continuum commands:
/status — Recent project activity
/resume — Pick up where you left off
/help — Show available commands`;

export const AI_COMMANDS_MESSAGE = `/catchup - Recover recent project context
/next - Get one recommended next action
/meeting - Prepare for the next project meeting`;

const TELEGRAM_AI_QUESTIONS: Record<AiMode, string> = {
  catch_up: "Summarize recent meaningful progress, unfinished work, and the most important next action.",
  next_action: "What is the one most important next action, and why does it matter?",
  meeting_prep: "Summarize the next relevant project meeting and the preparation points supported by project activity.",
};

const TELEGRAM_MESSAGE_LIMIT = 3_800;

export interface AiRecoveryServices {
  aggregateProjectAiContext(projectId: string): Promise<ProjectAiContext>;
  answerProjectQuestion(question: string, context: ProjectAiContext, mode: AiMode): Promise<AiContextResponse>;
}

const defaultAiRecoveryServices: AiRecoveryServices = { aggregateProjectAiContext, answerProjectQuestion };

function plainText(value: string, maxLength: number): string {
  return value
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sourceLinks(response: AiContextResponse, events: WorkEvent[], limit = 2): string[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  const links: string[] = [];
  for (const id of response.evidenceEventIds) {
    const event = eventsById.get(id);
    if (!event || !isSafeExternalUrl(event.sourceUrl) || seen.has(event.id)) continue;
    try {
      const url = new URL(event.sourceUrl);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.href.length > 500) continue;
      seen.add(event.id);
      const label = event.source === "google_calendar" ? "Calendar" : event.source === "github" ? "GitHub" : event.source === "jira" ? "Jira" : "Source";
      links.push(`${label}: ${url.href}`);
      if (links.length >= limit) break;
    } catch {
      // Ignore malformed persisted URLs.
    }
  }
  return links;
}

function eventStart(event: WorkEvent): number {
  const value = event.metadata.start ?? event.metadata.startDate ?? event.timestamp;
  return typeof value === "string" ? new Date(value).getTime() : Number.NaN;
}

function meetingLabel(event: WorkEvent): string {
  const title = typeof event.metadata.title === "string" && event.metadata.title.trim()
    ? event.metadata.title
    : event.summary;
  const startValue = event.metadata.start ?? event.metadata.startDate;
  const date = typeof startValue === "string" ? new Date(startValue) : new Date(event.timestamp);
  const allDay = typeof event.metadata.startDate === "string" && Boolean(event.metadata.startDate);
  const when = Number.isNaN(date.getTime())
    ? "time not available"
    : allDay
      ? `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} · All day`
      : date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${plainText(title, 180)} · ${when}`;
}

function buildAiMessage(mode: AiMode, projectName: string, response: AiContextResponse, events: WorkEvent[], now = Date.now()): string {
  const header = `${plainText(projectName, 100)} · ${mode === "catch_up" ? "Catch me up" : mode === "next_action" ? "Next action" : "Meeting prep"}`;
  let body: string;

  if (mode === "catch_up") {
    const summary = plainText(response.answer, 1_200) || "There is not enough recent activity to summarize.";
    const action = plainText(response.nextSteps[0] ?? "", 550) || "No evidence-backed next action was identified.";
    body = `${header}\n\n${summary}\n\nPrimary next action: ${action}`;
  } else if (mode === "next_action") {
    const action = plainText(response.nextSteps[0] ?? "", 650) || "No evidence-backed next action was identified.";
    const reason = plainText(response.answer, 900) || "The available project activity does not support a more specific reason.";
    body = `${header}\n\n${action}\n\nWhy: ${reason}`;
  } else {
    const meeting = events
      .filter((event) => event.source === "google_calendar" && eventStart(event) >= now)
      .sort((left, right) => eventStart(left) - eventStart(right))[0];
    if (!meeting) return `${header}\n\nNo upcoming project meeting is available on the configured calendar.`;
    const points = response.upcomingMeetings
      .map((item) => plainText(item, 350))
      .filter(Boolean)
      .slice(0, 3);
    body = `${header}\n\nNext meeting: ${meetingLabel(meeting)}${points.length ? `\n\nPreparation points:\n${points.map((point) => `- ${point}`).join("\n")}` : "\n\nNo specific preparation points are supported by the available project activity."}`;
  }

  const links = sourceLinks(response, events);
  const withLinks = links.length ? `${body}\n\nSources:\n${links.join("\n")}` : body;
  return withLinks.length <= TELEGRAM_MESSAGE_LIMIT
    ? withLinks
    : `${withLinks.slice(0, TELEGRAM_MESSAGE_LIMIT - 1).trimEnd()}…`;
}

export async function buildAiRecoveryMessage(
  projectId: string,
  mode: AiMode,
  services: AiRecoveryServices = defaultAiRecoveryServices,
): Promise<string> {
  const context = await services.aggregateProjectAiContext(projectId);
  if (context.events.length === 0) {
    if (mode === "meeting_prep") {
      return `${plainText(context.project.name, 100)} · Meeting prep\n\nNo upcoming project meeting is available on the configured calendar.`;
    }
    return `${plainText(context.project.name, 100)} · ${mode === "next_action" ? "Next action" : "Catch me up"}\n\nNo recent project activity is available yet.`;
  }
  const response = await services.answerProjectQuestion(TELEGRAM_AI_QUESTIONS[mode], context, mode);
  return buildAiMessage(mode, context.project.name, response, context.events);
}

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
