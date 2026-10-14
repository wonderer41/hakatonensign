import assert from "node:assert/strict";
import test from "node:test";
import { zonedTimeToUtc } from "@/lib/time/zone";
import { describeTrigger, formatDuration, localTimeInstant, nextDailyRun, nextIntervalRun, validateTrigger } from "./schedule";

const DENVER = "America/Denver";
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTimeToUtc(date, h * 60 + m, DENVER);
};

test("daily runs land on the next local occurrence", () => {
  const midnight = { hour: 0, minute: 0 };
  const retention = { hour: 3, minute: 30 };
  // 15:00 Denver on Oct 14 → midnight starting Oct 15, 03:30 on Oct 15.
  assert.equal(nextDailyRun(at("2026-10-14", "15:00"), midnight, DENVER).toISOString(), "2026-10-15T06:00:00.000Z");
  assert.equal(nextDailyRun(at("2026-10-14", "15:00"), retention, DENVER).toISOString(), "2026-10-15T09:30:00.000Z");
  // 02:00 local is before today's 03:30.
  assert.equal(nextDailyRun(at("2026-10-14", "02:00"), retention, DENVER).toISOString(), "2026-10-14T09:30:00.000Z");
});

test("a daily run is strictly after the given instant, so it never repeats", () => {
  const exactly = at("2026-10-15", "00:00");
  assert.equal(nextDailyRun(exactly, { hour: 0, minute: 0 }, DENVER).toISOString(), "2026-10-16T06:00:00.000Z");
  assert.equal(nextDailyRun(new Date(exactly.getTime() - 1), { hour: 0, minute: 0 }, DENVER).toISOString(), exactly.toISOString());
});

test("daily runs follow local time across DST changes", () => {
  // Spring forward 2026-03-08: midnight is still 07:00Z (MST), the next one is 06:00Z (MDT).
  assert.equal(nextDailyRun(at("2026-03-07", "12:00"), { hour: 0, minute: 0 }, DENVER).toISOString(), "2026-03-08T07:00:00.000Z");
  assert.equal(nextDailyRun(at("2026-03-08", "12:00"), { hour: 0, minute: 0 }, DENVER).toISOString(), "2026-03-09T06:00:00.000Z");
  // 03:30 on spring-forward day is MDT (09:30Z); on fall-back day it is MST (10:30Z).
  assert.equal(nextDailyRun(at("2026-03-08", "00:00"), { hour: 3, minute: 30 }, DENVER).toISOString(), "2026-03-08T09:30:00.000Z");
  assert.equal(nextDailyRun(at("2026-11-01", "00:00"), { hour: 3, minute: 30 }, DENVER).toISOString(), "2026-11-01T10:30:00.000Z");
});

test("a wall time skipped by spring-forward runs right after the jump; a repeated one runs once", () => {
  // 02:30 does not exist on 2026-03-08 in Denver → 03:30 MDT.
  assert.equal(localTimeInstant("2026-03-08", 150, DENVER).toISOString(), "2026-03-08T09:30:00.000Z");
  assert.equal(nextDailyRun(at("2026-03-08", "00:00"), { hour: 2, minute: 30 }, DENVER).toISOString(), "2026-03-08T09:30:00.000Z");
  // 01:30 happens twice on 2026-11-01 → the first (MDT, 07:30Z); after it, the next run is the following day.
  const first = nextDailyRun(at("2026-11-01", "00:00"), { hour: 1, minute: 30 }, DENVER);
  assert.equal(first.toISOString(), "2026-11-01T07:30:00.000Z");
  assert.equal(nextDailyRun(first, { hour: 1, minute: 30 }, DENVER).toISOString(), "2026-11-02T08:30:00.000Z");
});

test("interval runs keep a fixed rate and skip ticks missed while running", () => {
  const start = new Date("2026-10-14T20:00:00.000Z");
  const every = 120_000;
  const after = (ms: number) => new Date(start.getTime() + ms);
  assert.equal(nextIntervalRun(start, every, after(800)).toISOString(), after(120_000).toISOString());
  assert.equal(nextIntervalRun(start, every, after(130_000)).toISOString(), after(240_000).toISOString());
  assert.equal(nextIntervalRun(start, every, after(120_000)).toISOString(), after(240_000).toISOString());
  // Clock moved backwards: still one interval after the last start.
  assert.equal(nextIntervalRun(start, every, after(-60_000)).toISOString(), after(120_000).toISOString());
});

test("triggers are validated and described for the startup log", () => {
  assert.doesNotThrow(() => validateTrigger({ everyMs: 120_000 }));
  assert.throws(() => validateTrigger({ everyMs: 0 }), /everyMs/);
  assert.throws(() => validateTrigger({ everyMs: 1.5 * 1000 + 0.5 }), /everyMs/);
  assert.throws(() => validateTrigger({ dailyAt: { hour: 24, minute: 0 } }), /dailyAt/);
  assert.throws(() => validateTrigger({ dailyAt: { hour: 3, minute: 60 } }), /dailyAt/);
  assert.equal(describeTrigger({ everyMs: 120_000 }), "every 2m");
  assert.equal(describeTrigger({ everyMs: 3_600_000 }), "every 1h");
  assert.equal(describeTrigger({ everyMs: 1_500 }), "every 1.5s");
  assert.equal(describeTrigger({ dailyAt: { hour: 3, minute: 30 } }), "daily 03:30");
  assert.equal(formatDuration(1234), "1.2s");
});
