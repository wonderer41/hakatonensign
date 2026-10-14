import assert from "node:assert/strict";
import test from "node:test";
import type { ItemProgress } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { toItemProgressDto } from "./dto";
import { parseProgressParams, progressChanges } from "./progress";

const pushedAt = new Date("2026-10-14T19:05:00.000Z");
const stored = {
  kind: "looks_done",
  note: "streak model and UI landed",
  pushedAt,
  repoFullName: "wonderer41/study-sessions",
  status: "pending",
} as const;
const same = { kind: "looks_done", note: stored.note, pushedAt: pushedAt.toISOString(), repoFullName: stored.repoFullName } as const;

test("D7: an identical re-send changes nothing", () => {
  assert.equal(progressChanges(stored, same), null);
  assert.equal(progressChanges({ ...stored, status: "dismissed" }, same), null);
});

test("D7: a changed note keeps its status unless a dismissed note changes kind", () => {
  assert.deepEqual(progressChanges(stored, { ...same, note: "UI still missing" }), { note: "UI still missing" });
  assert.deepEqual(progressChanges(stored, { ...same, kind: "partial" }), { kind: "partial" });
  assert.deepEqual(progressChanges({ ...stored, status: "confirmed" }, { ...same, kind: "partial" }), { kind: "partial" });
  // Dismissed + only the wording changed: stays dismissed.
  assert.deepEqual(progressChanges({ ...stored, status: "dismissed" }, { ...same, note: "reworded" }), { note: "reworded" });
  // Dismissed + Hermes changed its verdict: back to pending.
  assert.deepEqual(progressChanges({ ...stored, status: "dismissed" }, { ...same, kind: "partial" }), {
    kind: "partial",
    status: "pending",
    resolvedAt: null,
  });
  const moved = progressChanges(stored, { ...same, pushedAt: "2026-10-14T20:00:00.000Z" });
  assert.equal((moved?.pushedAt as Date).toISOString(), "2026-10-14T20:00:00.000Z");
});

test("progress DTO links the commit on GitHub", () => {
  const row: ItemProgress = {
    id: "p1",
    checklistItemId: "i1",
    repoFullName: "wonderer41/study-sessions",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    kind: "partial",
    note: "added the streak model; UI still missing",
    status: "pending",
    pushedAt,
    createdBy: "hermes",
    resolvedAt: null,
    createdAt: pushedAt,
    updatedAt: pushedAt,
  };
  assert.deepEqual(toItemProgressDto(row), {
    id: "p1",
    kind: "partial",
    status: "pending",
    note: "added the streak model; UI still missing",
    repoFullName: "wonderer41/study-sessions",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    commitUrl: "https://github.com/wonderer41/study-sessions/commit/0123456789abcdef0123456789abcdef01234567",
    pushedAt: "2026-10-14T19:05:00.000Z",
  });
});

test("browser progress routes take uuids", () => {
  const id = "5f0c2b9e-1d2a-4c3b-9f8e-7a6b5c4d3e2f";
  assert.deepEqual(parseProgressParams({ id: id.toUpperCase(), progressId: id }), { itemId: id, progressId: id });
  assert.throws(() => parseProgressParams({ id: "12", progressId: id }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.deepEqual(error.details, { field: "id" });
    return true;
  });
  assert.throws(() => parseProgressParams({ id, progressId: "x" }), HttpError);
});
