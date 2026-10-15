import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveActiveIndex, stepId, wrapIndex } from "./carousel-state";

const ids = ["message", "gmail", "infra", "stocks"] as const;

test("the selected slide keeps its place when other slides come and go", () => {
  assert.equal(resolveActiveIndex(ids, "infra"), 2);
  // gmail disappears: infra is now at index 1, still selected
  assert.equal(resolveActiveIndex(["message", "infra", "stocks"], "infra"), 1);
});

test("nothing selected, or the selected slide is gone, shows the first slide", () => {
  assert.equal(resolveActiveIndex(ids, null), 0);
  assert.equal(resolveActiveIndex(["message", "stocks"], "infra"), 0);
  assert.equal(resolveActiveIndex([], "infra"), 0);
});

test("stepping wraps around both ends", () => {
  assert.equal(wrapIndex(3, 1, 4), 0);
  assert.equal(wrapIndex(0, -1, 4), 3);
  assert.equal(wrapIndex(1, 1, 4), 2);
  assert.equal(wrapIndex(0, 0, 0), 0);
});

test("stepId returns the neighbouring slide id", () => {
  assert.equal(stepId(ids, "message", 1), "gmail");
  assert.equal(stepId(ids, "stocks", 1), "message");
  assert.equal(stepId(ids, "message", -1), "stocks");
});

test("stepId from a vanished slide steps from the first slide", () => {
  assert.equal(stepId(["message", "stocks"], "infra", 1), "stocks");
});

test("stepId has nothing to return without slides", () => {
  assert.equal(stepId([], null, 1), null);
});
