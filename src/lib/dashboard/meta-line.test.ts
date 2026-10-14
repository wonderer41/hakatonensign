import assert from "node:assert/strict";
import test from "node:test";
import { formatMetaLine } from "./meta-line";

const ZONE = "America/Denver";
// Wed 2026-10-14 12:00 in Denver (MDT, UTC-6).
const NOW = new Date("2026-10-14T18:00:00Z");
const repo = "wonderer41/homelab-dashboard";

function line(commitAt: string | null, weeklyCommits: number, extra: Record<string, unknown> = {}, repoFullName: string | null = repo) {
  const github = { defaultBranch: "main", lastCommitAt: commitAt, weeklyCommits, syncedAt: "2026-10-14T17:55:00.000Z" };
  return formatMetaLine({ repoFullName, meta: { github, ...extra } }, NOW, ZONE);
}

test("a commit from today shows the local time", () => {
  // 16:31 UTC is 10:31 in Denver.
  assert.equal(line("2026-10-14T16:31:05.000Z", 6), "last commit 10:31 · 6 this week");
  assert.equal(line("2026-10-14T16:31:05.000Z", 1), "last commit 10:31 · 1 this week");
});

test("local midnight decides what is today, not UTC", () => {
  // 02:30 UTC on the 14th is still the evening of the 13th in Denver.
  assert.equal(line("2026-10-14T02:30:00.000Z", 3), "last commit Tue 20:30 · 3 this week");
  // 06:00 UTC on the 14th is 00:00 in Denver: today.
  assert.equal(line("2026-10-14T06:00:00.000Z", 3), "last commit 00:00 · 3 this week");
});

test("within the last 6 days it shows the weekday, older it shows the date", () => {
  assert.equal(line("2026-10-13T22:00:00.000Z", 2), "last commit Tue 16:00 · 2 this week");
  assert.equal(line("2026-10-08T15:00:00.000Z", 1), "last commit Thu 09:00 · 1 this week");
  assert.equal(line("2026-10-07T15:00:00.000Z", 0), "last commit Oct 7 · none this week");
  assert.equal(line("2026-10-03T15:00:00.000Z", 0), "last commit Oct 3 · none this week");
});

test("the year appears only when the commit is from another year", () => {
  assert.equal(line("2025-12-28T15:00:00.000Z", 0), "last commit Dec 28, 2025 · none this week");
});

test("a commit stamped slightly in the future counts as today", () => {
  assert.equal(line("2026-10-14T18:05:00.000Z", 1), "last commit 12:05 · 1 this week");
});

test("the zone is respected (DST ends 2026-11-01 in Denver)", () => {
  const winter = new Date("2026-11-02T20:00:00Z");
  const text = formatMetaLine({ repoFullName: repo, meta: { github: { lastCommitAt: "2026-11-02T17:31:00.000Z", weeklyCommits: 4 } } }, winter, ZONE);
  assert.equal(text, "last commit 10:31 · 4 this week");
  const tokyo = formatMetaLine({ repoFullName: repo, meta: { github: { lastCommitAt: "2026-11-02T17:31:00.000Z", weeklyCommits: 4 } } }, winter, "Asia/Tokyo");
  assert.equal(tokyo, "last commit 02:31 · 4 this week");
});

test("a repo with no commits (or not synced yet) says so", () => {
  assert.equal(formatMetaLine({ repoFullName: repo, meta: {} }, NOW, ZONE), "no commits yet");
  assert.equal(line(null, 0), "no commits yet");
});

test("meta.note is appended, and stands alone on a card without a repo", () => {
  assert.equal(formatMetaLine({ repoFullName: repo, meta: { note: "design phase" } }, NOW, ZONE), "no commits yet · design phase");
  assert.equal(line("2026-10-14T16:31:05.000Z", 6, { note: "  design\nphase " }), "last commit 10:31 · 6 this week · design phase");
  assert.equal(formatMetaLine({ repoFullName: null, meta: { note: "reading list" } }, NOW, ZONE), "reading list");
});

test("no repo and no usable note → null", () => {
  assert.equal(formatMetaLine({ repoFullName: null, meta: {} }, NOW, ZONE), null);
  assert.equal(formatMetaLine({ repoFullName: "  ", meta: { note: "   " } }, NOW, ZONE), null);
  assert.equal(formatMetaLine({ repoFullName: null, meta: { note: 42 } }, NOW, ZONE), null);
  assert.equal(formatMetaLine({ repoFullName: null, meta: null }, NOW, ZONE), null);
});

test("stale github data on a card that lost its repo is not shown", () => {
  assert.equal(line("2026-10-14T16:31:05.000Z", 6, {}, null), null);
});

test("malformed meta.github falls back instead of throwing", () => {
  const meta = (github: unknown) => formatMetaLine({ repoFullName: repo, meta: { github } }, NOW, ZONE);
  assert.equal(meta("nope"), "no commits yet");
  assert.equal(meta({ lastCommitAt: "yesterday", weeklyCommits: 3 }), "no commits yet");
  assert.equal(meta({ lastCommitAt: "2026-10-14T16:31:05.000Z", weeklyCommits: "many" }), "last commit 10:31 · none this week");
  assert.equal(meta({ lastCommitAt: "2026-10-14T16:31:05.000Z", weeklyCommits: -2 }), "last commit 10:31 · none this week");
});
