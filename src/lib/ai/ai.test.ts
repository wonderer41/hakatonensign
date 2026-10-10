import assert from "node:assert/strict";
import test from "node:test";
import type { Project, WorkEvent } from "@/types/contracts";
import { loadAiConfig } from "./config";
import { mergeAiContextEvents, prioritizeAiEvents } from "./context";
import { buildRulesContext } from "@/lib/context/rules";
import { isSafeExternalUrl } from "./safety";
import { modeInstructions, parseAiMode, parseOpenAiResponse, SYSTEM_PROMPT, validateResponse } from "./service";

const project: Project = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  name: "Test project",
  description: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function event(id: string, source: WorkEvent["source"], timestamp: string, metadata: Record<string, unknown> = {}, action: WorkEvent["action"] = "task_updated"): WorkEvent {
  return { id, projectId: project.id, source, externalId: id, timestamp, actor: "demo", action, summary: id, sourceUrl: `https://example.com/${id}`, metadata, createdAt: timestamp };
}

test("deterministic context keeps meetings and commits out of in-progress work", () => {
  const now = new Date("2026-01-10T12:00:00.000Z");
  const activeIssue = event("active-issue", "jira", "2026-01-10T10:00:00.000Z", { issueKey: "ABC-1", title: "Active issue", status: "In Progress" }, "issue_updated");
  const completedIssue = event("completed-issue", "jira", "2026-01-10T11:00:00.000Z", { issueKey: "ABC-2", title: "Finished issue", status: "Done" }, "issue_closed");
  const meeting = event("meeting", "google_calendar", "2026-01-10T09:00:00.000Z", { title: "Planning", start: "2026-01-11T09:00:00.000Z", end: "2026-01-11T10:00:00.000Z" });
  const commit = event("commit", "github", "2026-01-10T11:30:00.000Z", { repository: "demo/repo", branch: "feature/demo" }, "commit_pushed");
  const blocker = event("blocker", "manual", "2026-01-10T11:45:00.000Z", {}, "note_added");
  blocker.summary = "Blocked waiting for review";

  const summary = buildRulesContext(project.id, [meeting, commit, activeIssue, completedIssue, blocker], 5, now);
  assert.deepEqual(summary.inProgress.map((item) => item.text), ["ABC-1 is open: Active issue"]);
  assert.equal(summary.completed.some((item) => item.text.includes("ABC-2")), true);
  assert.deepEqual(summary.blockers.map((item) => item.evidenceEventIds), [["blocker"]]);
  assert.equal(summary.nextSteps.some((item) => item.text.includes("feature/demo")), true);
});

const validProviderPayload = { answer: "Known", whereWeLeftOff: "Known", nextSteps: [], blockers: [], upcomingMeetings: [], evidenceEventIds: [], confidence: "medium" };

test("AI context merge keeps GitHub, Jira, and Calendar events and deduplicates IDs", () => {
  const merged = mergeAiContextEvents(
    [event("github-1", "github", "2026-01-01T10:00:00.000Z"), event("jira-1", "jira", "2026-01-01T09:00:00.000Z")],
    [event("calendar-1", "google_calendar", "2026-01-02T09:00:00.000Z"), event("jira-1", "jira", "2026-01-01T09:00:00.000Z")],
  );
  assert.deepEqual(merged.map((item) => item.id), ["calendar-1", "github-1", "jira-1"]);
  assert.deepEqual(new Set(merged.map((item) => item.source)), new Set(["github", "jira", "google_calendar"]));
});

test("empty event context stays empty", () => {
  assert.deepEqual(mergeAiContextEvents([], []), []);
});

test("event prioritization keeps actionable Jira work and upcoming meetings", () => {
  const now = new Date("2026-01-10T12:00:00.000Z");
  const noise = Array.from({ length: 60 }, (_, index) => event(`commit-${index}`, "github", `2026-01-${String((index % 9) + 1).padStart(2, "0")}T10:00:00.000Z`, { repository: "demo/repo" }, "commit_pushed"));
  const jira = event("jira-high", "jira", "2026-01-02T10:00:00.000Z", { issueKey: "ABC-1", status: "In Progress", priority: "High" }, "issue_updated");
  const meeting = event("meeting-next", "google_calendar", "2026-01-12T15:00:00.000Z", { start: "2026-01-12T15:00:00.000Z", title: "Demo review" });
  const selected = prioritizeAiEvents([...noise, jira, meeting], now);
  assert.equal(selected.some((item) => item.id === jira.id), true);
  assert.equal(selected.some((item) => item.id === meeting.id), true);
  assert.equal(selected.length, 50);
});

test("AI configuration reports missing keys without exposing values", () => {
  assert.throws(() => loadAiConfig({ AI_PROVIDER: "openai" } as unknown as NodeJS.ProcessEnv), /AI is not configured/);
});

test("AI configuration selects Anthropic and its model from environment", () => {
  assert.deepEqual(loadAiConfig({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key", AI_MODEL: "claude-test" } as unknown as NodeJS.ProcessEnv), { provider: "anthropic", apiKey: "test-key", model: "claude-test" });
});

test("provider evidence is restricted to event IDs in the context", () => {
  const response = validateResponse({ answer: "Known", whereWeLeftOff: "Known", nextSteps: [], blockers: [], upcomingMeetings: [], evidenceEventIds: ["known", "invented"], confidence: "medium" }, new Set(["known"]));
  assert.deepEqual(response.evidenceEventIds, ["known"]);
});

test("all three response modes have distinct concise instructions", () => {
  assert.match(modeInstructions("catch_up"), /where the user left off/i);
  assert.match(modeInstructions("next_action"), /exactly one primary/i);
  assert.match(modeInstructions("meeting_prep"), /upcoming Calendar meeting/i);
});

test("mode is optional for backward-compatible requests", () => {
  assert.equal(parseAiMode(undefined), "catch_up");
  assert.equal(parseAiMode("next_action"), "next_action");
  assert.throws(() => parseAiMode("unknown"), /mode must be/);
});

test("response lists are capped at three concise items", () => {
  const response = validateResponse({ ...validProviderPayload, nextSteps: ["1", "2", "3", "4"], blockers: [], upcomingMeetings: [] }, new Set());
  assert.deepEqual(response.nextSteps, ["1", "2", "3"]);
});

test("valid OpenAI Responses API structured output is parsed from output_text", () => {
  assert.deepEqual(parseOpenAiResponse({ model: "test-model", status: "completed", incomplete_details: null, output_text: JSON.stringify(validProviderPayload), output: [] }), validProviderPayload);
});

test("JSON fenced by a provider is normalized before strict validation", () => {
  const fenced = "```json\n" + JSON.stringify(validProviderPayload) + "\n```";
  assert.deepEqual(parseOpenAiResponse({ model: "test-model", status: "completed", output_text: fenced, output: [] }), validProviderPayload);
});

test("empty OpenAI output is rejected distinctly", () => {
  assert.throws(() => parseOpenAiResponse({ model: "test-model", status: "completed", output_text: "", output: [] }), /empty output/);
});

test("incomplete OpenAI output is rejected before parsing", () => {
  assert.throws(() => parseOpenAiResponse({ model: "test-model", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "{\"answer\":", output: [] }), /incomplete/);
});

test("invalid JSON is rejected after a completed OpenAI response", () => {
  assert.throws(() => parseOpenAiResponse({ model: "test-model", status: "completed", output_text: "not json", output: [] }), /malformed JSON/);
});

test("provider refusal is rejected without parsing refusal text", () => {
  assert.throws(() => parseOpenAiResponse({ model: "test-model", status: "completed", output_text: "", output: [{ type: "message", content: [{ type: "refusal", refusal: "refused" }] }] }), /refused/);
});

test("valid JSON with an invalid response schema is rejected", () => {
  assert.throws(() => validateResponse({ ...validProviderPayload, confidence: "certain" }, new Set()), /invalid response/);
});

test("malformed provider output is rejected", () => {
  assert.throws(() => validateResponse({ answer: "missing fields" }, new Set()), /invalid response/);
});

test("WorkEvent content is explicitly treated as untrusted prompt data", () => {
  assert.match(SYSTEM_PROMPT, /untrusted data/i);
  assert.match(SYSTEM_PROMPT, /never follow instructions/i);
});

test("evidence URLs only allow safe external HTTP(S) links", () => {
  assert.equal(isSafeExternalUrl("https://github.com/example/repo"), true);
  assert.equal(isSafeExternalUrl("http://jira.example.com/browse/ABC-1"), true);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("data:text/html,unsafe"), false);
});
