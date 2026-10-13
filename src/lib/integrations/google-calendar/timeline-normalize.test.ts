import assert from "node:assert/strict";
import test from "node:test";
import type { GoogleCalendarWindowEvent } from "./client";
import { toCalendarEventFields } from "./timeline-normalize";

const DENVER = "America/Denver";
const ITEM_ID = "3f2b8c1e-5d4a-4c3b-9a8f-1e2d3c4b5a69";
const ALERT_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function googleEvent(extra: Partial<GoogleCalendarWindowEvent> = {}): GoogleCalendarWindowEvent {
  return {
    id: "evt1",
    status: "confirmed",
    summary: "Work shift",
    description: null,
    htmlLink: "https://calendar.google.com/event?eid=evt1",
    etag: '"123"',
    start: { dateTime: "2026-10-12T15:30:00-06:00" },
    end: { dateTime: "2026-10-12T18:30:00-06:00" },
    privateProperties: {},
    ...extra,
  };
}

test("timed events keep their instants", () => {
  const fields = toCalendarEventFields(googleEvent(), DENVER);
  assert.ok(fields);
  assert.equal(fields.startsAt.toISOString(), "2026-10-12T21:30:00.000Z");
  assert.equal(fields.endsAt.toISOString(), "2026-10-13T00:30:00.000Z");
  assert.equal(fields.allDay, false);
  assert.equal(fields.kind, "calendar");
});

test("all-day events are pinned to local midnight with an exclusive end", () => {
  const fields = toCalendarEventFields(googleEvent({ start: { date: "2026-10-12" }, end: { date: "2026-10-13" } }), DENVER);
  assert.ok(fields);
  assert.equal(fields.allDay, true);
  assert.equal(fields.startsAt.toISOString(), "2026-10-12T06:00:00.000Z");
  assert.equal(fields.endsAt.toISOString(), "2026-10-13T06:00:00.000Z");
});

test("Hermes work blocks are detected from the private property or the description markers", () => {
  const byProperty = toCalendarEventFields(googleEvent({ privateProperties: { homelabDailyItemId: ITEM_ID.toUpperCase() } }), DENVER);
  assert.equal(byProperty?.kind, "work_block");
  assert.equal(byProperty?.itemRef, ITEM_ID);

  const byMarker = toCalendarEventFields(googleEvent({ description: `https://github.com/x/y/issues/13\n[homelab-daily:item:${ITEM_ID}]` }), DENVER);
  assert.equal(byMarker?.itemRef, ITEM_ID);

  const alert = toCalendarEventFields(googleEvent({ description: `[homelab-daily:alert:${ALERT_ID}]` }), DENVER);
  assert.equal(alert?.kind, "work_block");
  assert.equal(alert?.alertRef, ALERT_ID);

  const junk = toCalendarEventFields(googleEvent({ privateProperties: { homelabDailyItemId: "not-a-uuid" } }), DENVER);
  assert.equal(junk?.kind, "calendar");
  assert.equal(junk?.itemRef, null);
});

test("cancelled stubs without times map to null; untitled events get a placeholder", () => {
  assert.equal(toCalendarEventFields(googleEvent({ status: "cancelled", start: null, end: null }), DENVER), null);
  assert.equal(toCalendarEventFields(googleEvent({ summary: null }), DENVER)?.title, "(No title)");
});
