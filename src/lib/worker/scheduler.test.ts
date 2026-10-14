import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { zonedTimeToUtc } from "@/lib/time/zone";
import { type JobContext, Scheduler } from "./scheduler";

const DENVER = "America/Denver";
const T0 = zonedTimeToUtc("2026-10-14", 15 * 60, DENVER).getTime();

// Lets pending promise callbacks run (setImmediate is not mocked).
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(t: TestContext, now = T0) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now });
  const lines: string[] = [];
  const scheduler = new Scheduler({ timeZone: DENVER, log: (line) => lines.push(line), logError: (line) => lines.push(line) });
  const elapsed = () => Date.now() - now;
  return { scheduler, lines, elapsed };
}

test("interval jobs run at start, never overlap, and skip ticks missed while running", async (t) => {
  const { scheduler, lines, elapsed } = setup(t);
  const starts: number[] = [];
  const runs: ReturnType<typeof deferred>[] = [];
  scheduler.register({
    name: "slow",
    trigger: { everyMs: 1_000 },
    run: async () => {
      starts.push(elapsed());
      const run = deferred();
      runs.push(run);
      await run.promise;
      return "did 3 things";
    },
  });

  scheduler.start();
  assert.deepEqual(starts, [0]);
  t.mock.timers.tick(2_500); // ticks at 1000 and 2000 arrive while the first run is still going
  await flush();
  assert.deepEqual(starts, [0]);

  runs[0].resolve();
  await flush();
  assert.match(lines[0], /^\[worker\] slow ok 2\.5s did 3 things$/);
  t.mock.timers.tick(499);
  await flush();
  assert.deepEqual(starts, [0]);
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(starts, [0, 3_000]);

  runs[1].resolve();
  await scheduler.stop();
});

test("a failing job is logged and still runs on the next tick", async (t) => {
  const { scheduler, lines } = setup(t);
  let calls = 0;
  scheduler.register({
    name: "flaky",
    trigger: { everyMs: 1_000 },
    run: async () => {
      calls += 1;
      throw new Error("upstream said no\n  details");
    },
  });

  scheduler.start();
  await flush();
  assert.equal(calls, 1);
  assert.equal(lines[0], "[worker] flaky failed: upstream said no details");
  t.mock.timers.tick(1_000);
  await flush();
  assert.equal(calls, 2);
  await scheduler.stop();
});

test("stop() waits for the running job and nothing runs afterwards", async (t) => {
  const { scheduler } = setup(t);
  const run = deferred();
  let calls = 0;
  let finished = false;
  scheduler.register({
    name: "busy",
    trigger: { everyMs: 1_000 },
    run: async () => {
      calls += 1;
      await run.promise;
      finished = true;
    },
  });

  scheduler.start();
  let stopped = false;
  const stopping = scheduler.stop().then(() => {
    stopped = true;
  });
  await flush();
  assert.equal(stopped, false);
  run.resolve();
  await stopping;
  assert.equal(finished, true);
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(calls, 1);
});

test("daily jobs run at the local time with scheduledFor set to that instant", async (t) => {
  const beforeMidnight = zonedTimeToUtc("2026-10-14", 23 * 60 + 58, DENVER).getTime();
  const { scheduler } = setup(t, beforeMidnight);
  const contexts: JobContext[] = [];
  scheduler.register({
    name: "rollover",
    trigger: { dailyAt: { hour: 0, minute: 0 } },
    run: async (context) => {
      contexts.push(context);
    },
  });

  scheduler.start();
  await flush();
  assert.equal(contexts.length, 0);
  assert.equal(scheduler.nextRuns()[0].nextAt?.toISOString(), "2026-10-15T06:00:00.000Z");

  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(contexts.length, 0);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].scheduledFor.toISOString(), "2026-10-15T06:00:00.000Z");
  assert.equal(contexts[0].timeZone, DENVER);
  assert.equal(scheduler.nextRuns()[0].nextAt?.toISOString(), "2026-10-16T06:00:00.000Z");
  await scheduler.stop();
});

test("job names must be unique kebab-case and triggers valid", () => {
  const scheduler = new Scheduler({ timeZone: DENVER, log: () => {}, logError: () => {} });
  const run = async () => {};
  scheduler.register({ name: "calendar-sync", trigger: { everyMs: 120_000 }, run });
  assert.throws(() => scheduler.register({ name: "calendar-sync", trigger: { everyMs: 120_000 }, run }), /registered twice/);
  assert.throws(() => scheduler.register({ name: "Calendar Sync", trigger: { everyMs: 120_000 }, run }), /kebab-case/);
  assert.throws(() => scheduler.register({ name: "too-fast", trigger: { everyMs: 10 }, run }), /too-fast.*everyMs/);
});
