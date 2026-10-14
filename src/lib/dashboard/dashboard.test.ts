import assert from "node:assert/strict";
import test from "node:test";
import type { Sprint } from "@/generated/prisma/client";
import { assertWritable, VersionConflict } from "./concurrency";
import { currentItem, daysBetween, toSprintDto } from "./dto";
import { canonicalJson, mergeMeta, sameJson } from "./json";

function reason(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    assert.ok(error instanceof VersionConflict);
    return error.reason;
  }
}

test("D15: a change needs the current version or force; done needs force", () => {
  assert.equal(reason(() => assertWritable({ version: 4, force: false }, 4, ["title"])), null);
  assert.equal(reason(() => assertWritable({ version: undefined, force: true }, 4, ["title"])), null);
  assert.equal(reason(() => assertWritable({ version: undefined, force: false }, 4, ["title"])), "version_required");
  assert.equal(reason(() => assertWritable({ version: 3, force: false }, 4, ["title"])), "stale_version");
  assert.equal(reason(() => assertWritable({ version: 4, force: false }, 4, ["done"], ["done"])), "done_is_user_owned");
  assert.equal(reason(() => assertWritable({ version: 4, force: true }, 4, ["done"], ["done"])), null);
});

test("meta merges shallowly and null removes a key", () => {
  assert.deepEqual(mergeMeta({ a: 1, b: 2 }, { b: 3, c: 4 }), { a: 1, b: 3, c: 4 });
  assert.deepEqual(mergeMeta({ a: 1, b: 2 }, { a: null }), { b: 2 });
  assert.deepEqual(mergeMeta("not an object", { a: 1 }), { a: 1 });
});

test("JSON comparison ignores key order (Postgres JSONB reorders keys)", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 1, c: [2, { z: 1, y: 2 }] } }), '{"a":{"c":[2,{"y":2,"z":1}],"d":1},"b":1}');
  assert.ok(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 }));
  assert.ok(!sameJson({ a: 1 }, { a: "1" }));
});

test("current item: open isCurrent is now, else first unchecked is next", () => {
  const at = new Date("2026-10-14T00:00:00Z");
  const item = (id: string, position: number, done: boolean, isCurrent = false) => ({ id, position, done, isCurrent, createdAt: at });
  assert.deepEqual(currentItem([item("a", 1000, false), item("b", 2000, false, true)])?.item.id, "b");
  assert.equal(currentItem([item("a", 1000, false), item("b", 2000, false, true)])?.label, "now");
  const next = currentItem([item("b", 2000, false), item("a", 1000, true), item("c", 1500, true, true)]);
  assert.equal(next?.item.id, "b");
  assert.equal(next?.label, "next");
  assert.equal(currentItem([item("a", 1000, true)]), null);
});

test("sprint daysLeft counts local days to endsOn, only for the active sprint", () => {
  const row = {
    id: "s1",
    externalKey: "hermes:sprint:2026-10-12",
    name: "Week 42",
    goal: null,
    startsOn: new Date("2026-10-12T00:00:00Z"),
    endsOn: new Date("2026-10-18T00:00:00Z"),
    status: "active",
    createdBy: "hermes",
    version: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Sprint;
  assert.equal(daysBetween("2026-10-14", "2026-10-18"), 4);
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2); // across DST
  assert.deepEqual(toSprintDto(row, "2026-10-14"), {
    id: "s1",
    externalKey: "hermes:sprint:2026-10-12",
    name: "Week 42",
    goal: null,
    startsOn: "2026-10-12",
    endsOn: "2026-10-18",
    status: "active",
    daysLeft: 4,
    version: 2,
  });
  assert.equal(toSprintDto(row, "2026-10-20").daysLeft, 0);
  assert.equal(toSprintDto({ ...row, status: "planned" }, "2026-10-14").daysLeft, null);
});
