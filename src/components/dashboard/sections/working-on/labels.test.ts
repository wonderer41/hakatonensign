import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChecklistItemDto } from "@/types/dashboard-contracts";
import { cardDisplayTitle, countLine, itemName, shortSha, sprintLine, timeTag } from "./labels";

const zone = "America/Denver";

test("card title: repo name for repo cards, else the card title", () => {
  assert.equal(cardDisplayTitle({ title: "Study sessions", repoFullName: "wonderer41/study-sessions" }), "study-sessions");
  assert.equal(cardDisplayTitle({ title: "homelab-dashboard", repoFullName: null }), "homelab-dashboard");
  assert.equal(cardDisplayTitle({ title: "Backups", repoFullName: "" }), "Backups");
});

test("sprint line", () => {
  assert.equal(sprintLine(null), "no active sprint");
  assert.equal(sprintLine({ name: "Seed sprint", daysLeft: 11 }), "Seed sprint · 11 days left");
  assert.equal(sprintLine({ name: "S", daysLeft: 1 }), "S · 1 day left");
  assert.equal(sprintLine({ name: "S", daysLeft: 0 }), "S · last day");
  assert.equal(sprintLine({ name: "S", daysLeft: null }), "S");
});

test("count line says issues only when every item is an issue", () => {
  const withNumber = { issueNumber: 4 } as ChecklistItemDto;
  const without = { issueNumber: null } as ChecklistItemDto;
  assert.equal(countLine({ progress: { done: 5, total: 8 }, items: [withNumber, withNumber] }), "5 / 8 issues");
  assert.equal(countLine({ progress: { done: 1, total: 2 }, items: [withNumber, without] }), "1 / 2 items");
  assert.equal(countLine({ progress: { done: 0, total: 0 }, items: [] }), "0 / 0 items");
});

test("item names", () => {
  assert.equal(itemName({ issueNumber: 13, title: "Streak tracking" }), "#13 Streak tracking");
  assert.equal(itemName({ issueNumber: null, title: "Swap the UPS battery" }), "Swap the UPS battery");
});

test("time tag: plain range today, weekday on another day", () => {
  const now = "2026-10-14T18:00:00Z"; // Wed 12:00 MDT
  assert.equal(timeTag({ calendarEventId: "e", startsAt: "2026-10-15T01:00:00Z", endsAt: "2026-10-15T02:30:00Z" }, now, zone), "19:00–20:30");
  assert.equal(timeTag({ calendarEventId: "e", startsAt: "2026-10-16T01:00:00Z", endsAt: "2026-10-16T02:30:00Z" }, now, zone), "Thu 19:00–20:30");
});

test("short sha", () => {
  assert.equal(shortSha("a41f0c9be2d7aa"), "a41f0c9");
});
