import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSourceDown } from "./source-down";

const zone = "America/Denver";
const now = new Date("2026-10-14T18:00:00Z"); // 12:00 MDT

test("same-day sync shows the clock", () => {
  const line = formatSourceDown("Calendar", { ok: false, lastSyncAt: "2026-10-14T16:42:00Z", error: "Calendar sync is overdue" }, zone, now);
  assert.equal(line, "Calendar unavailable — last synced 10:42");
});

test("an older sync shows the day too", () => {
  const line = formatSourceDown("Calendar", { ok: false, lastSyncAt: "2026-10-12T16:42:00Z", error: "x" }, zone, now);
  assert.equal(line, "Calendar unavailable — last synced Oct 12, 10:42");
});

test("no sync on record shows the reason, or a default", () => {
  assert.equal(
    formatSourceDown("Seerr", { ok: false, lastSyncAt: null, error: "Seerr is not configured" }, zone, now, "checked"),
    "Seerr unavailable — Seerr is not configured",
  );
  assert.equal(formatSourceDown("Seerr", { ok: false, lastSyncAt: null, error: null }, zone, now, "checked"), "Seerr unavailable — not checked yet");
});
