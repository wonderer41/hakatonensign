import type { Project, WorkEvent, ContextSummary } from "@/types/contracts";
import { getProjectContext } from "@/lib/db/context";
import { toProject, toWorkEvent } from "@/lib/db/mappers";
import { assertProjectExists } from "@/lib/db/projects";
import { prisma } from "@/lib/db/prisma";
import { isSafeExternalUrl } from "./safety";

const RECENT_EVENT_LIMIT = 120;
const CALENDAR_EVENT_LIMIT = 30;
const MAX_AI_EVENTS = 50;
const MAX_UPCOMING_MEETINGS = 8;
const MAX_PROMPT_CHARS = 50_000;
const SENSITIVE_KEY = /(token|secret|password|credential|authorization|api[_-]?key)/i;
const SENSITIVE_VALUE = /(bearer\s+|-----begin [^-]+ key-----|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)/i;

export interface ProjectAiContext {
  project: Project;
  rules: ContextSummary;
  events: WorkEvent[];
  promptContext: string;
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (SENSITIVE_VALUE.test(value)) return "[redacted]";
  return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
}

function safeValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return safeString(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeValue(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([childKey, childValue]) => [childKey, safeValue(childValue, childKey)]));
  }
  return value;
}

function eventForPrompt(event: WorkEvent): Record<string, unknown> {
  const metadata = event.metadata;
  const relevantMetadata: Record<string, unknown> = {};
  for (const key of ["repository", "issueKey", "issueNumber", "prNumber", "title", "status", "statusCategory", "priority", "assignee", "issueType", "branch", "start", "end", "timeZone", "startDate", "endDate", "recurringEventId", "resolutionDate"]) {
    if (metadata[key] !== undefined && metadata[key] !== null) relevantMetadata[key] = safeValue(metadata[key], key);
  }
  return {
    id: event.id,
    source: event.source,
    action: event.action,
    timestamp: event.timestamp,
    summary: safeString(event.summary),
    metadata: relevantMetadata,
    sourceUrl: isSafeExternalUrl(event.sourceUrl) ? event.sourceUrl : null,
  };
}

function promptItems(events: WorkEvent[]): Record<string, unknown>[] {
  const commitGroups = new Map<string, WorkEvent[]>();
  const items: Record<string, unknown>[] = [];
  for (const event of events) {
    if (event.action === "commit_pushed") {
      const repository = typeof event.metadata.repository === "string" ? event.metadata.repository : "unknown repository";
      commitGroups.set(repository, [...(commitGroups.get(repository) ?? []), event]);
      continue;
    }
    items.push(eventForPrompt(event));
  }
  for (const [repository, commits] of commitGroups) {
    items.push({
      source: "github",
      action: "commit_activity",
      repository,
      summary: `${commits.length} recent commit${commits.length === 1 ? "" : "s"} in ${repository}`,
      latestTimestamp: commits[commits.length - 1]?.timestamp,
      evidenceEventIds: commits.map((event) => event.id),
    });
  }
  return items;
}

function boundedPromptContext(project: Project, rules: ContextSummary, events: WorkEvent[]): string {
  const base = { project: { id: project.id, name: project.name, description: safeString(project.description) }, deterministicContext: safeValue(rules), events: promptItems(events) };
  let selectedEvents = base.events;
  let serialized = JSON.stringify({ ...base, events: selectedEvents });
  while (serialized.length > MAX_PROMPT_CHARS && selectedEvents.length > 10) {
    selectedEvents = selectedEvents.slice(0, Math.max(10, selectedEvents.length - 10));
    serialized = JSON.stringify({ ...base, events: selectedEvents });
  }
  return serialized;
}

export function mergeAiContextEvents(recent: WorkEvent[], calendar: WorkEvent[]): WorkEvent[] {
  const byId = new Map([...recent, ...calendar].map((event) => [event.id, event]));
  return [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
}

function textMetadata(event: WorkEvent, key: string): string {
  const value = event.metadata[key];
  return typeof value === "string" ? value.toLowerCase() : "";
}

function eventScore(event: WorkEvent, now: number): number {
  const ageDays = Math.max(0, (now - new Date(event.timestamp).getTime()) / 86_400_000);
  let score = Math.max(0, 500 - ageDays * 8);
  if (event.source === "google_calendar") {
    const start = new Date(textMetadata(event, "start") || event.timestamp).getTime();
    if (start >= now) score += 2_000 + Math.max(0, 300 - (start - now) / 86_400_000);
  }
  if (event.source === "jira") {
    const status = textMetadata(event, "status");
    const priority = textMetadata(event, "priority");
    if (["highest", "critical", "high", "blocker"].includes(priority)) score += 600;
    if (status.includes("progress") || status.includes("review")) score += 500;
    if (!["done", "closed", "resolved", "complete", "completed"].includes(status)) score += 250;
  }
  if (event.source === "github") {
    if (event.action.startsWith("pr_")) score += 450;
    if (event.action.startsWith("issue_")) score += 350;
    if (event.action === "commit_pushed") score += 80;
  }
  return score;
}

export function prioritizeAiEvents(events: WorkEvent[], now = new Date()): WorkEvent[] {
  const currentTime = now.getTime();
  const unique = mergeAiContextEvents(events, []);
  const upcoming = unique
    .filter((event) => event.source === "google_calendar" && new Date(textMetadata(event, "start") || event.timestamp).getTime() >= currentTime)
    .sort((a, b) => new Date(textMetadata(a, "start") || a.timestamp).getTime() - new Date(textMetadata(b, "start") || b.timestamp).getTime())
    .slice(0, MAX_UPCOMING_MEETINGS);
  const selected = new Map(upcoming.map((event) => [event.id, event]));
  for (const event of unique.sort((a, b) => eventScore(b, currentTime) - eventScore(a, currentTime) || b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id))) {
    if (selected.size >= MAX_AI_EVENTS) break;
    selected.set(event.id, event);
  }
  return [...selected.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
}

export async function aggregateProjectAiContext(projectId: string): Promise<ProjectAiContext> {
  await assertProjectExists(projectId);
  const [projectRow, rules, recentRows, calendarRows] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    getProjectContext(projectId),
    prisma.workEvent.findMany({ where: { projectId }, orderBy: [{ timestamp: "desc" }, { id: "desc" }], take: RECENT_EVENT_LIMIT }),
    prisma.workEvent.findMany({ where: { projectId, source: "google_calendar", timestamp: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { timestamp: "asc" }, take: CALENDAR_EVENT_LIMIT }),
  ]);
  const events = prioritizeAiEvents(mergeAiContextEvents(recentRows.map(toWorkEvent), calendarRows.map(toWorkEvent)));
  const project = toProject(projectRow);
  return { project, rules, events, promptContext: boundedPromptContext(project, rules, events) };
}
