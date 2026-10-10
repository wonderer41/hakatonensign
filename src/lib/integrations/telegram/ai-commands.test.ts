import assert from "node:assert/strict";
import test from "node:test";
import type { AiContextResponse, ContextSummary, Project, WorkEvent } from "@/types/contracts";
import { HttpError } from "@/lib/api/http";
import type { ProjectAiContext } from "@/lib/ai/context";
import { handleTelegramUpdate } from "./polling";
import type { TelegramClient, TelegramUpdate } from "./client";

const projectId = "650621d2-cc22-4c86-9f6c-1fc8d5f9757f";
const project: Project = {
  id: projectId,
  workspaceId: "00000000-0000-4000-8000-000000000001",
  name: "Demo project",
  description: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const rules: ContextSummary = {
  projectId,
  generatedAt: "2026-01-01T00:00:00.000Z",
  completed: [],
  inProgress: [],
  blockers: [],
  nextSteps: [],
  activityCount: 2,
  mode: "rules",
};

function event(id: string, source: WorkEvent["source"], sourceUrl: string | null, metadata: Record<string, unknown> = {}): WorkEvent {
  return {
    id,
    projectId,
    source,
    externalId: id,
    timestamp: "2026-01-01T00:00:00.000Z",
    actor: "test",
    action: source === "google_calendar" ? "task_updated" : "issue_updated",
    summary: "Continuum planning",
    sourceUrl,
    metadata,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const githubEvent = event("event-github", "github", "https://github.com/org/repo/pull/7");
const jiraEvent = event("event-jira", "jira", "javascript:alert(1)");
const meetingEvent = event("event-meeting", "google_calendar", "https://calendar.google.com/event", {
  title: "Project review",
  start: "2099-05-12T16:30:00.000Z",
});
const context: ProjectAiContext = {
  project,
  rules,
  events: [githubEvent, jiraEvent, meetingEvent],
  promptContext: "{}",
};
const response: AiContextResponse = {
  answer: "Recent progress is steady. Review the open issue before the demo. https://attacker.invalid/",
  whereWeLeftOff: "",
  nextSteps: ["Review the open issue before the demo.", "Update the project notes."],
  blockers: [],
  upcomingMeetings: ["Confirm the demo flow.", "Review open issues.", "Assign follow-ups.", "Extra point."],
  evidenceEventIds: [githubEvent.id, jiraEvent.id, "missing-event-id"],
  confidence: "medium",
};

async function sendCommand(
  command: string,
  services: {
    aggregateProjectAiContext: (id: string) => Promise<ProjectAiContext>;
    answerProjectQuestion: (question: string, context: ProjectAiContext, mode: "catch_up" | "next_action" | "meeting_prep") => Promise<AiContextResponse>;
  },
) {
  const sent: string[] = [];
  const client = { sendMessage: async (_chatId: number, text: string) => { sent.push(text); } } as unknown as TelegramClient;
  await handleTelegramUpdate({
    update_id: 1,
    message: { message_id: 1, chat: { id: 123, type: "private" }, text: command },
  } satisfies TelegramUpdate, {
    client,
    config: { token: "test-token", projectId, allowedChatIds: new Set(["123"]) },
    aiRecovery: services,
  });
  return sent;
}

test("AI Telegram commands use their mapped modes and configured project", async () => {
  const calls: { projectId: string; mode: string; question: string }[] = [];
  const services = {
    aggregateProjectAiContext: async (id: string) => { calls.push({ projectId: id, mode: "aggregate", question: "" }); return context; },
    answerProjectQuestion: async (question: string, _context: ProjectAiContext, mode: "catch_up" | "next_action" | "meeting_prep") => {
      calls.push({ projectId, mode, question });
      return response;
    },
  };
  const catchup = await sendCommand("/catchup", services);
  const next = await sendCommand("/next@ContinuumBot", services);
  const meeting = await sendCommand("/meeting", services);

  assert.deepEqual(calls.filter((call) => call.mode !== "aggregate").map((call) => call.mode), ["catch_up", "next_action", "meeting_prep"]);
  assert.ok(calls.every((call) => call.projectId === projectId));
  assert.match(catchup[0], /Primary next action:/);
  assert.match(next[0], /Why:/);
  assert.match(meeting[0], /Next meeting: Project review/);
  assert.equal((meeting[0].match(/^- /gm) ?? []).length, 3);
});

test("AI Telegram output links only persisted safe evidence and strips AI URLs", async () => {
  const sent = await sendCommand("/catchup", {
    aggregateProjectAiContext: async () => context,
    answerProjectQuestion: async () => response,
  });
  assert.match(sent[0], /https:\/\/github\.com\/org\/repo\/pull\/7/);
  assert.doesNotMatch(sent[0], /attacker\.invalid|javascript:/);
  assert.ok(sent[0].length <= 3_800);
});

test("AI provider failures reply safely without escaping command polling", async () => {
  const logs: string[] = [];
  const sent: string[] = [];
  const client = { sendMessage: async (_chatId: number, text: string) => { sent.push(text); } } as unknown as TelegramClient;
  await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 123, type: "private" }, text: "/next" } }, {
    client,
    config: { token: "test-token", projectId, allowedChatIds: new Set(["123"]) },
    aiRecovery: {
      aggregateProjectAiContext: async () => context,
      answerProjectQuestion: async () => { throw new HttpError("AI_PROVIDER_ERROR", "private provider detail"); },
    },
    log: (message) => logs.push(message),
  });
  assert.match(sent[0], /unavailable right now/i);
  assert.deepEqual(logs, ["Telegram AI context command failed"]);
  assert.doesNotMatch(sent.join(" "), /private provider detail/);
});

test("missing AI configuration gets a short helpful reply", async () => {
  const sent: string[] = [];
  const client = { sendMessage: async (_chatId: number, text: string) => { sent.push(text); } } as unknown as TelegramClient;
  await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 123, type: "private" }, text: "/catchup" } }, {
    client,
    config: { token: "test-token", projectId, allowedChatIds: new Set(["123"]) },
    aiRecovery: {
      aggregateProjectAiContext: async () => context,
      answerProjectQuestion: async () => { throw new HttpError("AI_NOT_CONFIGURED", "AI is not configured"); },
    },
  });
  assert.match(sent[0], /not configured/i);
  assert.doesNotMatch(sent[0], /api key|token/i);
});

test("meeting prep says when there is no upcoming meeting", async () => {
  const noMeetingContext = { ...context, events: [githubEvent, jiraEvent] };
  let calledMode = "";
  const sent = await sendCommand("/meeting", {
    aggregateProjectAiContext: async () => noMeetingContext,
    answerProjectQuestion: async (_question, _context, mode) => { calledMode = mode; return response; },
  });
  assert.equal(calledMode, "meeting_prep");
  assert.match(sent[0], /No upcoming project meeting/);
  assert.doesNotMatch(sent[0], /attacker\.invalid|javascript:/);
});

test("existing status and resume commands remain available", async () => {
  const sent: string[] = [];
  const client = { sendMessage: async (_chatId: number, text: string) => { sent.push(text); } } as unknown as TelegramClient;
  const reader = {
    getProject: async () => project,
    getRecentEvents: async () => [githubEvent],
    getContext: async () => rules,
  };
  const options = {
    client,
    config: { token: "test-token", projectId, allowedChatIds: new Set(["123"]) },
    reader,
  };
  await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 123, type: "private" }, text: "/status" } }, options);
  await handleTelegramUpdate({ update_id: 2, message: { message_id: 2, chat: { id: 123, type: "private" }, text: "/resume" } }, options);
  assert.match(sent[0], /Recent GitHub activity/);
  assert.match(sent[1], /Resume my work/);
});
