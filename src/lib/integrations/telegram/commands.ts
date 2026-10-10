import { getProjectContext } from "@/lib/db/context";
import { listRecentEvents } from "@/lib/db/events";
import { listProjects } from "@/lib/db/projects";
import { aggregateProjectAiContext, type ProjectAiContext } from "@/lib/ai/context";
import { answerProjectQuestion } from "@/lib/ai/service";
import { isSafeExternalUrl } from "@/lib/ai/safety";
import { catchupCheckpointStore, type CatchupCheckpointStore } from "./catchup-checkpoints";
import type { AiContextResponse, AiMode, ContextSummary, Project, WorkEvent } from "@/types/contracts";

export const TELEGRAM_COMMANDS = [
  { command: "start", description: "Start Continuum" },
  { command: "help", description: "Show available commands" },
  { command: "status", description: "Project health summary" },
  { command: "resume", description: "Resume meaningful project work" },
  { command: "catchup", description: "Summarize changes since last catchup" },
  { command: "next", description: "Get one evidence-based next action" },
  { command: "meeting", description: "Prepare for the next project meeting" },
] as const;

const commandDescriptions = TELEGRAM_COMMANDS.map(({ command, description }) => `/${command} — ${description}`).join("\n");
export const HELP_MESSAGE = `Continuum commands:\n${commandDescriptions}`;
export const START_MESSAGE = `Welcome to Continuum! Your work, connected.\n\n${HELP_MESSAGE}`;

const TELEGRAM_AI_QUESTIONS: Record<AiMode, string> = {
  catch_up: "Summarize recent meaningful progress, unfinished work, and the most important next action.",
  next_action: "What is the one most important next action, and why does it matter?",
  meeting_prep: "Summarize the next relevant project meeting and the preparation points supported by project activity.",
};

const TELEGRAM_MESSAGE_LIMIT = 3_800;

export interface AiRecoveryServices {
  aggregateProjectAiContext(projectId: string, options?: { since?: Date; sinceInclusive?: boolean }): Promise<ProjectAiContext>;
  answerProjectQuestion(question: string, context: ProjectAiContext, mode: AiMode): Promise<AiContextResponse>;
}

const defaultAiRecoveryServices: AiRecoveryServices = { aggregateProjectAiContext, answerProjectQuestion };

function plainText(value: string, maxLength: number): string {
  return value
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/gi, "")
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
    body = `${header}\n\nSuggested action: ${action}\n\nWhy (from project context): ${reason}`;
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

export async function buildCatchupMessage(
  projectId: string,
  telegramChatId: string,
  telegramUserId: string,
  services: AiRecoveryServices = defaultAiRecoveryServices,
  checkpoints: CatchupCheckpointStore = catchupCheckpointStore,
  now = new Date(),
): Promise<{ text: string; checkpointAt: Date }> {
  const previousCheckpoint = await checkpoints.get(telegramChatId, telegramUserId, projectId);
  const since = previousCheckpoint ?? new Date(now.getTime() - 72 * 60 * 60 * 1_000);
  const context = await services.aggregateProjectAiContext(projectId, { since, sinceInclusive: previousCheckpoint === null });
  const windowLabel = previousCheckpoint
    ? "Since your previous successful /catchup"
    : "First catchup: looking back 72 hours";

  if (context.events.length === 0) {
    return {
      text: `${plainText(context.project.name, 100)} · Catch me up\n${windowLabel}\n\nNo meaningful project changes in this window.`,
      checkpointAt: now,
    };
  }

  const response = await services.answerProjectQuestion(TELEGRAM_AI_QUESTIONS.catch_up, context, "catch_up");
  const summary = plainText(response.answer, 1_300);
  if (!summary) throw new Error("AI catchup response was incomplete");
  const action = plainText(response.nextSteps[0] ?? "", 450);
  const normalizedSummary = summary.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  const normalizedAction = action.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const pieces = [
    `${plainText(context.project.name, 100)} · Catch me up`,
    windowLabel,
    summary,
    ...(action && (!normalizedAction || !normalizedSummary.includes(normalizedAction)) ? [`Suggested next action: ${action}`] : []),
  ];
  const links = sourceLinks(response, context.events);
  if (links.length) pieces.push(`Sources:\n${links.join("\n")}`);
  const text = pieces.join("\n\n");
  if (text.length > TELEGRAM_MESSAGE_LIMIT) throw new Error("AI catchup response exceeded the Telegram message limit");
  return { text, checkpointAt: now };
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
  getRecentEvents: (projectId) => listRecentEvents(projectId, 200),
  getContext: getProjectContext,
};

function projectNotFound(projectId: string): Error {
  return new Error(`Configured Continuum project ${projectId} was not found`);
}

export function formatStatus(project: Project, context: ContextSummary): string {
  const active = context.inProgress.slice(0, 2).map((item) => plainText(item.text, 240));
  const completed = context.completed.slice(0, 1).map((item) => plainText(item.text, 240));
  const blockers = context.blockers.slice(0, 2).map((item) => plainText(item.text, 240));
  const lines = [plainText(project.name, 100), `Active work: ${active.length ? active.join("; ") : "none recorded"}`, `Completed: ${completed.length ? completed.join("; ") : "none recorded"}`];
  if (blockers.length) lines.push(`Blockers: ${blockers.join("; ")}`);
  return lines.join("\n").slice(0, TELEGRAM_MESSAGE_LIMIT);
}

function evidenceLinks(items: { evidenceEventIds: string[] }[], events: WorkEvent[], limit = 2): string[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  const links: string[] = [];
  for (const item of items) {
    for (const id of item.evidenceEventIds) {
      const event = byId.get(id);
      if (!event || seen.has(id) || !isSafeExternalUrl(event.sourceUrl)) continue;
      seen.add(id);
      const source = event.source === "google_calendar" ? "Calendar" : event.source === "github" ? "GitHub" : event.source === "jira" ? "Jira" : "Source";
      links.push(`${source}: ${event.sourceUrl}`);
      if (links.length === limit) return links;
    }
  }
  return links;
}

function isPullRequestOrCommit(text: string): boolean {
  return /\b(?:PR\s*#?\d*|pull request|commit(?:s)?)\b/i.test(text);
}

export function formatResume(project: Project, context: ContextSummary, events: WorkEvent[] = []): string {
  const leftOff = context.inProgress.find((item) => !isPullRequestOrCommit(item.text));
  const completedMeaningful = context.completed.find((item) => !isPullRequestOrCommit(item.text));
  const nextAction = context.nextSteps.find((item) => !isPullRequestOrCommit(item.text));
  const leftOffText = leftOff?.text ?? (completedMeaningful ? "Recent tracked work is reflected in completed activity." : "No active tracked work is recorded yet.");
  const actionText = nextAction?.text ?? (leftOff ? "Continue the active project work." : "No evidence-backed next action is available yet.");
  const lines = [
    `${plainText(project.name, 100)} — Resume`,
    `Where work left off: ${plainText(leftOffText, 500)}`,
    `Suggested next action: ${plainText(actionText, 500)}`,
  ];
  const links = evidenceLinks([...(leftOff ? [leftOff] : []), ...(nextAction ? [nextAction] : [])], events);
  if (links.length) lines.push(`Sources: ${links.join(" · ")}`);
  return lines.join("\n\n").slice(0, TELEGRAM_MESSAGE_LIMIT);
}

export async function getProjectOrThrow(reader: ContinuumReader, projectId: string): Promise<Project> {
  const project = await reader.getProject(projectId);
  if (!project) throw projectNotFound(projectId);
  return project;
}

export async function buildStatusMessage(reader: ContinuumReader, projectId: string): Promise<string> {
  const [project, context] = await Promise.all([
    getProjectOrThrow(reader, projectId),
    reader.getContext(projectId),
  ]);
  return formatStatus(project, context);
}

export async function buildResumeMessage(reader: ContinuumReader, projectId: string): Promise<string> {
  const [project, context, events] = await Promise.all([
    getProjectOrThrow(reader, projectId),
    reader.getContext(projectId),
    reader.getRecentEvents(projectId),
  ]);
  return formatResume(project, context, events);
}
