import assert from "node:assert/strict";
import test from "node:test";
import type { AiContextResponse, ContextSummary, Project, WorkEvent } from "@/types/contracts";
import { HttpError } from "@/lib/api/http";
import type { ProjectAiContext } from "@/lib/ai/context";
import { buildCatchupMessage, HELP_MESSAGE, START_MESSAGE, TELEGRAM_COMMANDS, type AiRecoveryServices } from "./commands";
import { handleTelegramUpdate, pollTelegram } from "./polling";
import type { TelegramClient, TelegramUpdate } from "./client";
import type { CatchupCheckpointStore } from "./catchup-checkpoints";
import { formatNewGitHubActivity } from "./notifications";

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
  services: AiRecoveryServices,
  extra: { checkpoints?: CatchupCheckpointStore; onSend?: (text: string) => void; failSend?: boolean } = {},
) {
  const sent: string[] = [];
  const checkpoints = extra.checkpoints ?? { get: async () => null, save: async () => {} };
  const client = { sendMessage: async (_chatId: number, text: string) => { if (extra.failSend) throw new Error("send failed"); sent.push(text); extra.onSend?.(text); } } as unknown as TelegramClient;
  await handleTelegramUpdate({
    update_id: 1,
    message: { message_id: 1, chat: { id: 123, type: "private" }, from: { id: 456 }, text: command },
  } satisfies TelegramUpdate, {
    client,
    config: { token: "test-token", projectId, allowedChatIds: new Set(["123"]) },
    aiRecovery: services,
    checkpoints,
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
  assert.doesNotMatch(catchup[0], /Suggested next action:/);
  assert.match(next[0], /Why \(from project context\):/);
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
  await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 123, type: "private" }, from: { id: 456 }, text: "/catchup" } }, {
    client,
    config: { token: "test-token", projectId, allowedChatIds: new Set(["123"]) },
    checkpoints: memoryCheckpoints().store,
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

test("status and resume use short deterministic context", async () => {
  const sent: string[] = [];
  const client = { sendMessage: async (_chatId: number, text: string) => { sent.push(text); } } as unknown as TelegramClient;
  const deterministic = {
    ...rules,
    inProgress: [
      { text: "SCRUM-8 is open: Finish demo checklist", evidenceEventIds: [githubEvent.id] },
      { text: "PR #7 is open", evidenceEventIds: [githubEvent.id] },
    ],
    completed: [{ text: "SCRUM-6 was closed: Calendar sync", evidenceEventIds: [githubEvent.id] }],
    blockers: [{ text: "SCRUM-8 is marked as blocked", evidenceEventIds: [githubEvent.id] }],
    nextSteps: [
      { text: "Continue work on SCRUM-8", evidenceEventIds: [githubEvent.id] },
      { text: "Review the open PR #7", evidenceEventIds: [githubEvent.id] },
    ],
  };
  const reader = {
    getProject: async () => project,
    getRecentEvents: async () => [githubEvent],
    getContext: async () => deterministic,
  };
  const options = {
    client,
    config: { token: "test-token", projectId, allowedChatIds: new Set(["123"]) },
    reader,
  };
  await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 123, type: "private" }, text: "/status" } }, options);
  await handleTelegramUpdate({ update_id: 2, message: { message_id: 2, chat: { id: 123, type: "private" }, text: "/resume" } }, options);
  assert.match(sent[0], /Active work: SCRUM-8 is open/);
  assert.match(sent[0], /Completed: SCRUM-6 was closed/);
  assert.match(sent[0], /Blockers: SCRUM-8 is marked as blocked/);
  assert.match(sent[1], /Where work left off:/);
  assert.match(sent[1], /SCRUM-8 is open/);
  assert.match(sent[1], /Suggested next action:/);
  assert.doesNotMatch(sent[1], /PR #7|commit/);
  assert.match(sent[1], /https:\/\/github\.com\/org\/repo\/pull\/7/);
});

function memoryCheckpoints(initial: Date | null = null, log: string[] = []) {
  let value = initial;
  const store: CatchupCheckpointStore = {
    get: async () => value,
    save: async (_chat, _user, _project, checkpoint) => { log.push("checkpoint"); value = checkpoint; },
  };
  return { store, get value() { return value; } };
}

test("first catchup uses a 72-hour event window and checkpoints after successful send", async () => {
  const order: string[] = [];
  const checkpoint = memoryCheckpoints(null, order);
  let since: Date | undefined;
  let inclusive = false;
  const sent = await sendCommand("/catchup", {
    aggregateProjectAiContext: async (_id, options) => { since = options?.since; inclusive = options?.sinceInclusive ?? false; return context; },
    answerProjectQuestion: async () => response,
  }, { checkpoints: checkpoint.store, onSend: () => order.push("send") });

  assert.ok(since);
  assert.ok(Date.now() - since.getTime() >= 71 * 60 * 60 * 1_000);
  assert.ok(Date.now() - since.getTime() <= 73 * 60 * 60 * 1_000);
  assert.match(sent[0], /First catchup: looking back 72 hours/);
  assert.equal(inclusive, true);
  assert.deepEqual(order, ["send", "checkpoint"]);
  assert.ok(checkpoint.value instanceof Date);
});

test("subsequent catchup uses the saved checkpoint and scoped changes", async () => {
  const prior = new Date("2026-02-03T04:05:06.000Z");
  const checkpoint = memoryCheckpoints(prior);
  let since: Date | undefined;
  let inclusive = true;
  const sent = await sendCommand("/catchup@ContinuumBot", {
    aggregateProjectAiContext: async (_id, options) => { since = options?.since; inclusive = options?.sinceInclusive ?? true; return context; },
    answerProjectQuestion: async (_question, actualContext) => { assert.deepEqual(actualContext.events, context.events); return response; },
  }, { checkpoints: checkpoint.store });
  assert.equal(since?.toISOString(), prior.toISOString());
  assert.equal(inclusive, false);
  assert.match(sent[0], /Since your previous successful \/catchup/);
});

test("empty catchup window sends an explicit no-change message and advances checkpoint", async () => {
  const checkpoint = memoryCheckpoints();
  const emptyContext = { ...context, events: [] };
  let answered = false;
  const sent = await sendCommand("/catchup", {
    aggregateProjectAiContext: async () => emptyContext,
    answerProjectQuestion: async () => { answered = true; return response; },
  }, { checkpoints: checkpoint.store });
  assert.match(sent[0], /No meaningful project changes in this window/);
  assert.equal(answered, false);
  assert.ok(checkpoint.value instanceof Date);
});

test("failed AI response does not advance catchup checkpoint", async () => {
  const checkpoint = memoryCheckpoints();
  const sent = await sendCommand("/catchup", {
    aggregateProjectAiContext: async () => context,
    answerProjectQuestion: async () => { throw new HttpError("AI_PROVIDER_ERROR", "private provider detail"); },
  }, { checkpoints: checkpoint.store });
  assert.match(sent[0], /unavailable right now/i);
  assert.equal(checkpoint.value, null);
});

test("incomplete AI response does not advance catchup checkpoint", async () => {
  const checkpoint = memoryCheckpoints();
  const sent = await sendCommand("/catchup", {
    aggregateProjectAiContext: async () => context,
    answerProjectQuestion: async () => ({ ...response, answer: "   " }),
  }, { checkpoints: checkpoint.store });
  assert.match(sent[0], /unavailable right now/i);
  assert.equal(checkpoint.value, null);
});

test("failed Telegram delivery does not advance catchup checkpoint", async () => {
  const checkpoint = memoryCheckpoints();
  const services = {
    aggregateProjectAiContext: async () => context,
    answerProjectQuestion: async () => response,
  };
  await assert.rejects(sendCommand("/catchup", services, { checkpoints: checkpoint.store, failSend: true }), /send failed/);
  assert.equal(checkpoint.value, null);
});

test("catchup formatting deduplicates verified evidence and strips unsafe links and ISO timestamps", async () => {
  const duplicateEvidence: AiContextResponse = {
    ...response,
    answer: "Progress was recorded at 2026-02-03T04:05:06.000Z. https://attacker.invalid/",
    evidenceEventIds: [githubEvent.id, githubEvent.id, jiraEvent.id, "not-in-context"],
  };
  const prepared = await buildCatchupMessage(projectId, "123", "456", {
    aggregateProjectAiContext: async () => ({ ...context, events: [githubEvent, jiraEvent] }),
    answerProjectQuestion: async () => duplicateEvidence,
  }, memoryCheckpoints().store, new Date("2026-02-03T05:00:00.000Z"));
  assert.equal((prepared.text.match(/https:\/\/github\.com\/org\/repo\/pull\/7/g) ?? []).length, 1);
  assert.doesNotMatch(prepared.text, /attacker\.invalid|javascript:|2026-02-03T/);
  assert.ok(prepared.text.length <= 3_800);
});

test("help and start only show routed, registered commands", async () => {
  const sent: string[] = [];
  const client = { sendMessage: async (_chatId: number, text: string) => { sent.push(text); } } as unknown as TelegramClient;
  const options = { client, config: { token: "test-token", projectId, allowedChatIds: new Set(["123"]) } };
  await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 123, type: "private" }, text: "/start@ContinuumBot" } }, options);
  await handleTelegramUpdate({ update_id: 2, message: { message_id: 2, chat: { id: 123, type: "private" }, text: "/help" } }, options);
  for (const { command } of TELEGRAM_COMMANDS) {
    assert.match(sent[0], new RegExp(`/${command}\\b`));
    assert.match(sent[1], new RegExp(`/${command}\\b`));
  }
  assert.equal(START_MESSAGE.includes("/catchup"), true);
  assert.equal(HELP_MESSAGE.includes("/next"), true);
});

test("polling handles each Telegram update once and advances its offset after handling", async () => {
  const controller = new AbortController();
  const offsets: (number | null)[] = [];
  const sent: string[] = [];
  let polls = 0;
  const update: TelegramUpdate = { update_id: 1, message: { message_id: 1, chat: { id: 123, type: "private" }, text: "/help" } };
  const client = {
    getUpdates: async (offset: number | null) => {
      offsets.push(offset);
      polls += 1;
      if (polls === 1) return [update, update];
      controller.abort();
      return [];
    },
    sendMessage: async (_chatId: number, text: string) => { sent.push(text); },
  } as unknown as TelegramClient;
  await pollTelegram({ client, config: { token: "test-token", projectId, allowedChatIds: new Set(["123"]) } }, controller.signal);
  assert.equal(sent.length, 1);
  assert.deepEqual(offsets, [null, 2]);
});

test("missing configured project returns a helpful message without guessing", async () => {
  const sent: string[] = [];
  const client = { sendMessage: async (_chatId: number, text: string) => { sent.push(text); } } as unknown as TelegramClient;
  await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 123, type: "private" }, text: "/status" } }, {
    client,
    config: { token: "test-token", projectId, allowedChatIds: new Set(["123"]) },
    reader: { getProject: async () => null, getRecentEvents: async () => [], getContext: async () => rules },
  });
  assert.match(sent[0], /configured Continuum project could not be found/i);
  assert.doesNotMatch(sent[0], new RegExp(projectId));
});

test("GitHub notifications still report important activity and omit commit noise", () => {
  const notification = formatNewGitHubActivity(project.name, [
    { ...githubEvent, action: "pr_opened", summary: "PR opened: Improve demo" },
    { ...githubEvent, id: "commit-event", action: "commit_pushed", summary: "Pushed commit abc123" },
  ]);
  assert.match(notification ?? "", /PR opened: Improve demo/);
  assert.doesNotMatch(notification ?? "", /Pushed commit/);
});
