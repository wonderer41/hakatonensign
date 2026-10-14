import assert from "node:assert/strict";
import test from "node:test";
import { createDenialLog } from "./denial-log";

function setup(maxTracked?: number) {
  let clock = 1_000_000;
  const lines: string[] = [];
  const log = createDenialLog({ windowMs: 60_000, now: () => clock, write: (line) => lines.push(line), maxTracked });
  return {
    log,
    lines,
    advance(ms: number) {
      clock += ms;
    },
  };
}

test("the first refusal is logged at once, the rest of the minute is counted", () => {
  const { log, lines, advance } = setup();
  log.record("192.168.1.77");
  assert.deepEqual(lines, ["[acl] denied 192.168.1.77 (1 request)"]);
  advance(1_000);
  log.record("192.168.1.77");
  advance(1_000);
  log.record("192.168.1.77");
  assert.equal(lines.length, 1);

  advance(58_000);
  log.record("192.168.1.77");
  assert.deepEqual(lines, ["[acl] denied 192.168.1.77 (1 request)", "[acl] denied 192.168.1.77 (3 requests)"]);
});

test("flush reports what is pending once the window ends and forgets idle addresses", () => {
  const { log, lines, advance } = setup();
  log.record("10.0.0.1");
  log.record("10.0.0.1");
  log.record("10.0.0.1");
  log.flush();
  assert.equal(lines.length, 1, "nothing to report before the window ends");

  advance(60_000);
  log.flush();
  assert.deepEqual(lines.slice(1), ["[acl] denied 10.0.0.1 (2 requests)"]);

  advance(60_000);
  log.flush();
  assert.equal(lines.length, 2, "an address with nothing pending is dropped silently");
  log.record("10.0.0.1");
  assert.equal(lines.at(-1), "[acl] denied 10.0.0.1 (1 request)", "and starts fresh when it comes back");
});

test("addresses are throttled independently", () => {
  const { log, lines } = setup();
  log.record("10.0.0.1");
  log.record("10.0.0.2");
  log.record("10.0.0.1");
  assert.deepEqual(lines, ["[acl] denied 10.0.0.1 (1 request)", "[acl] denied 10.0.0.2 (1 request)"]);
});

test("memory is bounded: the oldest address is reported and dropped", () => {
  const { log, lines } = setup(2);
  log.record("10.0.0.1");
  log.record("10.0.0.1");
  log.record("10.0.0.2");
  log.record("10.0.0.3");
  assert.deepEqual(lines, [
    "[acl] denied 10.0.0.1 (1 request)",
    "[acl] denied 10.0.0.2 (1 request)",
    "[acl] denied 10.0.0.1 (1 request)",
    "[acl] denied 10.0.0.3 (1 request)",
  ]);
});
