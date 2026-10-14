import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import { parseNoInput, parseUpsertAlert, parseUpsertCard, parseUpsertItem, parseUpsertSprint } from "./parse";

function field(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "VALIDATION_ERROR");
    return (error.details as { field: string }).field;
  }
  assert.fail("expected a validation error");
}

test("card upserts: absent means keep, null means clear, unknown fields fail", () => {
  const card = parseUpsertCard({ title: " Orphan cleanup ", sprintKey: "hermes:sprint:2026-10-12", hermesSuggestion: null, version: 3 });
  assert.equal(card.title, "Orphan cleanup");
  assert.equal(card.sprintKey, "hermes:sprint:2026-10-12");
  assert.equal(card.hermesSuggestion, null);
  assert.equal(card.milestoneTitle, undefined);
  assert.equal(card.version, 3);
  assert.equal(card.force, false);
  assert.equal(field(() => parseUpsertCard({ title: "x", colour: "red" })), "colour");
  assert.equal(field(() => parseUpsertCard({ title: "x", sprintKey: "sprint-1" })), "sprintKey");
  assert.equal(field(() => parseUpsertCard({ title: "x", repoFullName: "not a repo" })), "repoFullName");
  assert.equal(field(() => parseUpsertCard({ title: "x".repeat(161) })), "title");
  assert.equal(field(() => parseUpsertCard({ title: "x", version: 0 })), "version");
  assert.equal(field(() => parseUpsertCard({ title: "x", force: "yes" })), "force");
  assert.equal(field(() => parseUpsertCard({ title: "x", status: "deleted" })), "status");
});

test("item upserts validate types and urls", () => {
  const item = parseUpsertItem({ title: "Review the 4 BDMV folders", isCurrent: true, issueNumber: null });
  assert.equal(item.isCurrent, true);
  assert.equal(item.issueNumber, null);
  assert.equal(item.done, undefined);
  assert.equal(field(() => parseUpsertItem({ title: "x", done: "true" })), "done");
  assert.equal(field(() => parseUpsertItem({ title: "x", sourceUrl: "ftp://x" })), "sourceUrl");
  assert.equal(field(() => parseUpsertItem({ title: "x", position: -1 })), "position");
});

test("sprint upserts need real, ordered dates", () => {
  const sprint = parseUpsertSprint({ name: "Week 42", startsOn: "2026-10-12", endsOn: "2026-10-18", status: "active" });
  assert.equal(sprint.status, "active");
  assert.equal(sprint.goal, undefined);
  assert.equal(field(() => parseUpsertSprint({ name: "x", startsOn: "2026-10-12", endsOn: "2026-10-11" })), "endsOn");
  assert.equal(field(() => parseUpsertSprint({ name: "x", startsOn: "12/10/2026", endsOn: "2026-10-18" })), "startsOn");
});

test("alerts and empty-input routes", () => {
  assert.equal(parseUpsertAlert({ source: "scan", title: "jellyfin restarting" }).severity, undefined);
  assert.equal(field(() => parseUpsertAlert({ source: "scan", title: "x", severity: "info" })), "severity");
  parseNoInput(undefined);
  parseNoInput({});
  assert.equal(field(() => parseNoInput({ force: true })), "force");
});
