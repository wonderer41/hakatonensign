import assert from "node:assert/strict";
import test from "node:test";
import type { LiveEvent } from "@/types/dashboard-contracts";
import { MAX_NOTIFY_PAYLOAD_BYTES, parseLiveEventPayload, serializeLiveEvent, toLiveEvent } from "./event";

const VALID: LiveEvent[] = [
  { type: "card.upserted", cardId: "c1" },
  { type: "card.removed", cardId: "c1" },
  { type: "item.upserted", cardId: "c1", itemId: "i1" },
  { type: "sprint.upserted", sprintId: "s1" },
  { type: "timeline.changed", date: "2026-10-14" },
  { type: "banner.updated", kind: "stocks" },
  { type: "banner.updated", kind: "dailyMessage" },
  { type: "alert.changed", alertId: "a1" },
  { type: "schedule.updated", scheduleId: "r1" },
  { type: "seerr.changed" },
  { type: "day.rollover", date: "2026-10-15" },
];

test("every LiveEvent shape round-trips through the NOTIFY payload", () => {
  for (const event of VALID) {
    assert.deepEqual(parseLiveEventPayload(serializeLiveEvent(event)), event);
  }
});

test("malformed payloads are ignored", () => {
  assert.equal(parseLiveEventPayload(undefined), null);
  assert.equal(parseLiveEventPayload(""), null);
  assert.equal(parseLiveEventPayload("{not json"), null);
  assert.equal(parseLiveEventPayload("null"), null);
  assert.equal(parseLiveEventPayload("[]"), null);
  assert.equal(parseLiveEventPayload('"card.upserted"'), null);
  assert.equal(parseLiveEventPayload('{"type":"card.deleted","cardId":"c1"}'), null);
  assert.equal(parseLiveEventPayload('{"type":"toString"}'), null);
  assert.equal(parseLiveEventPayload('{"cardId":"c1"}'), null);
});

test("required fields are checked per type", () => {
  assert.equal(toLiveEvent({ type: "card.upserted" }), null);
  assert.equal(toLiveEvent({ type: "card.upserted", cardId: "" }), null);
  assert.equal(toLiveEvent({ type: "card.upserted", cardId: 42 }), null);
  assert.equal(toLiveEvent({ type: "card.upserted", cardId: "x".repeat(201) }), null);
  assert.equal(toLiveEvent({ type: "item.upserted", cardId: "c1" }), null);
  assert.equal(toLiveEvent({ type: "timeline.changed", date: "2026-02-30" }), null);
  assert.equal(toLiveEvent({ type: "day.rollover", date: "2026-10-15T00:00:00Z" }), null);
  assert.equal(toLiveEvent({ type: "banner.updated", kind: "weather" }), null);
});

test("unknown extra fields are dropped so nothing else reaches the browser", () => {
  assert.deepEqual(toLiveEvent({ type: "card.upserted", cardId: "c1", title: "secret plans" }), { type: "card.upserted", cardId: "c1" });
  assert.deepEqual(toLiveEvent({ type: "seerr.changed", count: 3 }), { type: "seerr.changed" });
});

test("serialize rejects invalid and oversized events", () => {
  assert.throws(() => serializeLiveEvent({ type: "timeline.changed", date: "tomorrow" }), /Invalid live event/);
  const huge = { type: "card.upserted", cardId: "x".repeat(MAX_NOTIFY_PAYLOAD_BYTES) } as LiveEvent;
  assert.throws(() => serializeLiveEvent(huge), /Invalid live event/);
  assert.ok(Buffer.byteLength(serializeLiveEvent({ type: "item.upserted", cardId: "c".repeat(200), itemId: "i".repeat(200) })) < 8000);
});
