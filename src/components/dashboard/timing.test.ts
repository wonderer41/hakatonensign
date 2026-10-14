import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffDelay, msUntilNextLocalMidnight, msUntilNextMinute } from "./timing";

test("backoff doubles from 1 s and caps at 30 s", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 20].map((attempt) => backoffDelay(attempt)),
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000],
  );
});

test("next minute boundary", () => {
  assert.equal(msUntilNextMinute(Date.parse("2026-10-14T10:41:59.500Z")), 500);
  assert.equal(msUntilNextMinute(Date.parse("2026-10-14T10:42:00.000Z")), 60_000);
});

test("next local midnight in Denver, including the DST change on 2026-11-01", () => {
  const zone = "America/Denver";
  // 23:30 MDT on Oct 31 → midnight is 30 minutes away.
  assert.equal(msUntilNextLocalMidnight(Date.parse("2026-11-01T05:30:00Z"), zone), 30 * 60_000);
  // Noon MST on Nov 1 (a 25-hour day) → the next midnight is 12 hours away.
  assert.equal(msUntilNextLocalMidnight(Date.parse("2026-11-01T19:00:00Z"), zone), 12 * 3_600_000);
  // 18:00 MDT on Oct 14 → 6 hours.
  assert.equal(msUntilNextLocalMidnight(Date.parse("2026-10-15T00:00:00Z"), zone), 6 * 3_600_000);
});
