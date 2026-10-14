import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarSyncResult } from "@/lib/integrations/google-calendar/timeline-sync";
import { zonedTimeToUtc } from "@/lib/time/zone";
import type { LiveEvent } from "@/types/dashboard-contracts";
import { type CalendarJobDeps, formatCalendarJobResult, syncCalendarAndPublish, timelineDatesToPublish } from "./calendar-job";

const DENVER = "America/Denver";
const NOW = zonedTimeToUtc("2026-10-14", 15 * 60, DENVER);

function syncResult(changedDates: string[]): CalendarSyncResult {
  return {
    calendarId: "primary",
    window: { start: "2026-10-13T06:00:00.000Z", end: "2026-10-29T06:00:00.000Z" },
    fetched: 4,
    created: 1,
    updated: 1,
    cancelled: 0,
    unchanged: 2,
    complete: true,
    changedDates,
    syncedAt: NOW.toISOString(),
  };
}

function fakeDeps(options: { errors: (string | null | undefined)[]; sync: () => Promise<CalendarSyncResult> }) {
  const published: LiveEvent[] = [];
  const errors = [...options.errors];
  const deps: CalendarJobDeps = {
    sync: options.sync,
    readSyncError: async () => errors.shift(),
    publish: async (event) => {
      published.push(event);
    },
  };
  return { deps, published };
}

test("today is added only when the stored sync error changed", () => {
  assert.deepEqual(timelineDatesToPublish(["2026-10-16", "2026-10-15"], "2026-10-14", null, null), ["2026-10-15", "2026-10-16"]);
  assert.deepEqual(timelineDatesToPublish([], "2026-10-14", null, "Google OAuth token refresh failed"), ["2026-10-14"]);
  assert.deepEqual(timelineDatesToPublish([], "2026-10-14", "old", "old"), []);
  assert.deepEqual(timelineDatesToPublish(["2026-10-14"], "2026-10-14", "old", null), ["2026-10-14"]);
  assert.deepEqual(timelineDatesToPublish([], "2026-10-14", undefined, "x"), []);
});

test("a successful sync publishes timeline.changed for each changed date", async () => {
  const { deps, published } = fakeDeps({ errors: [null], sync: async () => syncResult(["2026-10-15", "2026-10-20"]) });
  const result = await syncCalendarAndPublish(NOW, DENVER, deps);
  assert.deepEqual(published, [
    { type: "timeline.changed", date: "2026-10-15" },
    { type: "timeline.changed", date: "2026-10-20" },
  ]);
  assert.equal(
    formatCalendarJobResult(result),
    "fetched 4 · created 1 · updated 1 · cancelled 0 · unchanged 2 · timeline.changed 2026-10-15, 2026-10-20",
  );
});

test("a sync that clears an earlier error also refreshes today", async () => {
  const { deps, published } = fakeDeps({ errors: ["Google OAuth token refresh failed"], sync: async () => syncResult([]) });
  await syncCalendarAndPublish(NOW, DENVER, deps);
  assert.deepEqual(published, [{ type: "timeline.changed", date: "2026-10-14" }]);
});

test("a failed sync publishes the new error state for today and rethrows", async () => {
  const { deps, published } = fakeDeps({
    errors: [null, "Google OAuth token refresh failed"],
    sync: async () => {
      throw new Error("Google OAuth token refresh failed");
    },
  });
  await assert.rejects(syncCalendarAndPublish(NOW, DENVER, deps), /token refresh failed/);
  assert.deepEqual(published, [{ type: "timeline.changed", date: "2026-10-14" }]);
});

test("a repeated identical failure publishes nothing", async () => {
  const { deps, published } = fakeDeps({
    errors: ["same", "same"],
    sync: async () => {
      throw new Error("same");
    },
  });
  await assert.rejects(syncCalendarAndPublish(NOW, DENVER, deps));
  assert.deepEqual(published, []);
});
