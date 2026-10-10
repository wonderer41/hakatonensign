import type { Project, WorkEvent, ContextSummary } from "@/types/contracts";
import { getProjectContext } from "@/lib/db/context";
import { toProject, toWorkEvent } from "@/lib/db/mappers";
import { assertProjectExists } from "@/lib/db/projects";
import { prisma } from "@/lib/db/prisma";
import { isSafeExternalUrl } from "./safety";

const RECENT_EVENT_LIMIT = 120;
const CALENDAR_EVENT_LIMIT = 30;
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
  return {
    id: event.id,
    source: event.source,
    action: event.action,
    timestamp: event.timestamp,
    summary: safeString(event.summary),
    description: safeString(typeof event.metadata.description === "string" ? event.metadata.description : null),
    metadata: safeValue(event.metadata),
    sourceUrl: isSafeExternalUrl(event.sourceUrl) ? event.sourceUrl : null,
  };
}

function boundedPromptContext(project: Project, rules: ContextSummary, events: WorkEvent[]): string {
  const base = { project: { id: project.id, name: project.name, description: safeString(project.description) }, deterministicContext: safeValue(rules), events: events.map(eventForPrompt) };
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

export async function aggregateProjectAiContext(projectId: string): Promise<ProjectAiContext> {
  await assertProjectExists(projectId);
  const [projectRow, rules, recentRows, calendarRows] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    getProjectContext(projectId),
    prisma.workEvent.findMany({ where: { projectId }, orderBy: [{ timestamp: "desc" }, { id: "desc" }], take: RECENT_EVENT_LIMIT }),
    prisma.workEvent.findMany({ where: { projectId, source: "google_calendar", timestamp: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { timestamp: "asc" }, take: CALENDAR_EVENT_LIMIT }),
  ]);
  const events = mergeAiContextEvents(recentRows.map(toWorkEvent), calendarRows.map(toWorkEvent));
  const project = toProject(projectRow);
  return { project, rules, events, promptContext: boundedPromptContext(project, rules, events) };
}
