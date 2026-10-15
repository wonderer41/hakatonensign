import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import { describeRef, parseDedupeKeyParam, parseKey, parseKeyParam, parseRef, refWhere } from "./keys";

function valid(value: string, kind: Parameters<typeof parseKey>[1]): boolean {
  try {
    parseKey(value, kind, "key");
    return true;
  } catch (error) {
    assert.ok(error instanceof HttpError);
    return false;
  }
}

test("card keys follow the documented key formats", () => {
  assert.ok(valid("hermes:card:orphan-cleanup", "card"));
  assert.ok(valid("github:milestone:wonderer41/study-sessions:3", "card"));
  assert.ok(valid("github:repo:wonderer41/pomanor-mcp", "card"));
  assert.ok(!valid("hermes:card:Orphan Cleanup", "card"));
  assert.ok(!valid("card:orphan-cleanup", "card"));
  assert.ok(!valid("github:repo:wonderer41", "card"));
  assert.ok(!valid(`hermes:card:${"a".repeat(200)}`, "card"));
});

test("item, sprint and alert keys", () => {
  assert.ok(valid("github:issue:wonderer41/study-sessions#13", "item"));
  assert.ok(valid("hermes:item:orphan-cleanup:review-bdmvs", "item"));
  assert.ok(!valid("hermes:item:review-bdmvs", "item"));
  assert.ok(!valid("github:issue:wonderer41/study-sessions#0", "item"));
  assert.ok(valid("hermes:sprint:2026-10-12", "sprint"));
  assert.ok(valid("github:milestone:wonderer41/study-sessions:3", "sprint"));
  assert.ok(!valid("hermes:card:2026-10-12", "sprint"));
  assert.ok(valid("container:jellyfin", "alert"));
  assert.ok(valid("proxmox:vzdump:vm100", "alert"));
  assert.ok(!valid("jellyfin", "alert"));
  assert.ok(!valid("Container:jellyfin", "alert"));
});

test("path keys are URL-decoded before validation", () => {
  assert.deepEqual(parseKeyParam("github%3Aissue%3Awonderer41%2Fstudy-sessions%2313", "item", "itemKey"), {
    kind: "key",
    key: "github:issue:wonderer41/study-sessions#13",
  });
  assert.deepEqual(parseKeyParam("hermes:card:orphan-cleanup", "card", "key"), { kind: "key", key: "hermes:card:orphan-cleanup" });
  assert.throws(() => parseKeyParam("hermes%3Acard%3A%E0%A4%A", "card", "key"), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.deepEqual(error.details, { field: "key" });
    return true;
  });
});

test("cards, items and sprints can be addressed by id:<uuid>", () => {
  const id = "5F0C2B9E-1D2A-4C3B-9F8E-7A6B5C4D3E2F";
  assert.deepEqual(parseKeyParam(`id%3A${id}`, "card", "key"), { kind: "id", id: id.toLowerCase() });
  assert.deepEqual(parseRef(`id:${id}`, "sprint", "sprintKey"), { kind: "id", id: id.toLowerCase() });
  assert.deepEqual(parseKeyParam(`id:${id}`, "item", "itemKey"), { kind: "id", id: id.toLowerCase() });
  assert.throws(() => parseKeyParam("id%3Anot-a-uuid", "card", "key"), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.deepEqual(error.details, { field: "key" });
    return true;
  });
  assert.throws(() => parseRef("id:", "item", "itemKey"), HttpError);
  assert.deepEqual(refWhere({ kind: "id", id: "x" }), { id: "x" });
  assert.deepEqual(refWhere({ kind: "key", key: "hermes:card:x" }), { externalKey: "hermes:card:x" });
  assert.equal(describeRef({ kind: "key", key: "hermes:card:x" }), "key hermes:card:x");
});

test("alerts are addressed by dedupeKey only", () => {
  assert.equal(parseDedupeKeyParam("container%3Ajellyfin", "dedupeKey"), "container:jellyfin");
  assert.throws(() => parseDedupeKeyParam("jellyfin", "dedupeKey"), HttpError);
});
