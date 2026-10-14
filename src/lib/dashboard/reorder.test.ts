import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import { assertKnownIds, planReorder } from "./reorder";

const GAP = 1000;

test("reorder: listed ids first, positions rewritten in gaps of 1000, only changed rows written", () => {
  const rows = [
    { id: "a", position: 1000 },
    { id: "b", position: 2000 },
    { id: "c", position: 3000 },
    { id: "d", position: 4000 },
  ];
  const plan = planReorder(rows, ["c", "a", "b"], GAP);
  assert.deepEqual(plan.order, ["c", "a", "b", "d"]);
  // d keeps 4000, so it is not rewritten.
  assert.deepEqual(plan.updates, [
    { id: "c", position: 1000 },
    { id: "a", position: 2000 },
    { id: "b", position: 3000 },
  ]);
});

test("reorder: unlisted rows keep their relative order after the listed ones", () => {
  const rows = [
    { id: "a", position: 1000 },
    { id: "hermes-new", position: 1500 },
    { id: "b", position: 2000 },
    { id: "c", position: 3000 },
  ];
  const plan = planReorder(rows, ["b", "a"], GAP);
  assert.deepEqual(plan.order, ["b", "a", "hermes-new", "c"]);
  assert.deepEqual(
    plan.updates.map((update) => [update.id, update.position]),
    [
      ["b", 1000],
      ["a", 2000],
      ["hermes-new", 3000],
      ["c", 4000],
    ],
  );
});

test("reorder: irregular or duplicate positions are normalized", () => {
  const rows = [
    { id: "a", position: 0 },
    { id: "b", position: 0 },
    { id: "c", position: 7 },
  ];
  const plan = planReorder(rows, ["a", "b", "c"], GAP);
  assert.deepEqual(plan.updates, [
    { id: "a", position: 1000 },
    { id: "b", position: 2000 },
    { id: "c", position: 3000 },
  ]);
});

test("reorder: the same order with clean gaps writes nothing", () => {
  const rows = [
    { id: "a", position: 1000 },
    { id: "b", position: 2000 },
  ];
  assert.deepEqual(planReorder(rows, ["a", "b"], GAP).updates, []);
});

test("reorder: an id that is not in the list is rejected with its field path", () => {
  const rows = [{ id: "a", position: 1000 }];
  assert.doesNotThrow(() => assertKnownIds(["a"], rows, "a card"));
  assert.throws(
    () => assertKnownIds(["a", "zzz"], rows, "a card"),
    (error: unknown) => error instanceof HttpError && error.code === "VALIDATION_ERROR" && JSON.stringify(error.details) === '{"field":"ids[1]"}',
  );
});
