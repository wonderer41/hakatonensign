import assert from "node:assert/strict";
import test from "node:test";
import { reconnectDelayMs } from "./subscribe";

test("reconnect backoff doubles from 1s and caps at 30s", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 50].map(reconnectDelayMs),
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000],
  );
  assert.equal(reconnectDelayMs(-3), 1_000);
  assert.equal(reconnectDelayMs(10_000), 30_000);
});
