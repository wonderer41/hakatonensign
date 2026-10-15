import assert from "node:assert/strict";
import test from "node:test";
import { zonedTimeToUtc } from "@/lib/time/zone";
import { formatRetentionResult, retentionCutoffs, runRetention } from "./retention";

const DENVER = "America/Denver";

test("cutoffs are local midnight N days before today", () => {
  const now = zonedTimeToUtc("2026-10-14", 3 * 60 + 30, DENVER); // 03:30 MDT
  const cutoffs = retentionCutoffs(now, DENVER);
  assert.equal(cutoffs.bannerSnapshot.toISOString(), "2026-09-30T06:00:00.000Z"); // 14 days
  assert.equal(cutoffs.scheduleRequest.toISOString(), "2026-09-14T06:00:00.000Z"); // 30 days
  assert.equal(cutoffs.resolvedAlert.toISOString(), "2026-09-14T06:00:00.000Z"); // 30 days
  assert.equal(cutoffs.calendarEvent.toISOString(), "2026-08-15T06:00:00.000Z"); // 60 days
});

test("cutoffs crossing a DST change use the offset of that past date", () => {
  const now = zonedTimeToUtc("2026-11-10", 3 * 60 + 30, DENVER); // MST now
  const cutoffs = retentionCutoffs(now, DENVER);
  assert.equal(cutoffs.bannerSnapshot.toISOString(), "2026-10-27T06:00:00.000Z"); // MDT then
  assert.equal(cutoffs.calendarEvent.toISOString(), "2026-09-11T06:00:00.000Z");
});

test("runRetention deletes by the right fields and keeps the newest snapshot per kind", async () => {
  const now = zonedTimeToUtc("2026-10-14", 3 * 60 + 30, DENVER);
  const calls: Record<string, unknown> = {};
  const deleter = (name: string, count: number) => ({
    deleteMany: (args: unknown) => {
      calls[name] = args;
      return count;
    },
  });
  const db = {
    bannerSnapshot: {
      ...deleter("bannerSnapshot", 3),
      // One findFirst per kind; only gmail and stocks have rows in this fixture.
      findFirst: async (args: { where: { kind: string } }) => {
        calls[`latest-${args.where.kind}`] = args;
        return args.where.kind === "gmail" ? { id: "keep-gmail" } : args.where.kind === "stocks" ? { id: "keep-stocks" } : null;
      },
    },
    scheduleRequest: deleter("scheduleRequest", 2),
    calendarEvent: deleter("calendarEvent", 5),
    alert: deleter("alert", 1),
    $transaction: async (operations: number[]) => operations.map((count) => ({ count })),
  };

  const result = await runRetention(db as unknown as Parameters<typeof runRetention>[0], now, DENVER);
  assert.deepEqual(result, { bannerSnapshots: 3, scheduleRequests: 2, calendarEvents: 5, resolvedAlerts: 1 });
  assert.deepEqual(calls.bannerSnapshot, {
    where: { capturedAt: { lt: new Date("2026-09-30T06:00:00.000Z") }, id: { notIn: ["keep-gmail", "keep-stocks"] } },
  });
  assert.deepEqual(calls.scheduleRequest, { where: { createdAt: { lt: new Date("2026-09-14T06:00:00.000Z") } } });
  assert.deepEqual(calls.calendarEvent, { where: { endsAt: { lt: new Date("2026-08-15T06:00:00.000Z") } } });
  assert.deepEqual(calls.alert, { where: { resolvedAt: { not: null, lt: new Date("2026-09-14T06:00:00.000Z") } } });
  assert.equal(formatRetentionResult(result), "deleted bannerSnapshots 3 · scheduleRequests 2 · calendarEvents 5 · resolvedAlerts 1");
});
