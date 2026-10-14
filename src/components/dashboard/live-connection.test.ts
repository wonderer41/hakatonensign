import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveEvent } from "@/types/dashboard-contracts";
import { LiveConnection, parseLiveEventData, type EventSourceLike } from "./live-connection";
import { fakeTimers } from "./test-timers";

class FakeSource implements EventSourceLike {
  closed = false;
  private listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  close(): void {
    this.closed = true;
  }
}

function setup() {
  const clock = fakeTimers();
  const sources: FakeSource[] = [];
  const events: LiveEvent[] = [];
  const reconnecting: boolean[] = [];
  let opens = 0;
  const connection = new LiveConnection({
    url: "/api/stream",
    timers: clock.timers,
    createSource: () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    onEvent: (event) => events.push(event),
    onOpen: () => (opens += 1),
    onReconnectingChange: (value) => reconnecting.push(value),
  });
  return { connection, clock, sources, events, reconnecting, opens: () => opens };
}

test("parseLiveEventData keeps objects with a type and drops anything else", () => {
  assert.deepEqual(parseLiveEventData('{"type":"seerr.changed"}'), { type: "seerr.changed" });
  assert.equal(parseLiveEventData("not json"), null);
  assert.equal(parseLiveEventData('{"cardId":"x"}'), null);
  assert.equal(parseLiveEventData(undefined), null);
});

test("open, change and ping", () => {
  const { connection, sources, events, opens } = setup();
  connection.start();
  sources[0].emit("open");
  sources[0].emit("change", '{"type":"card.upserted","cardId":"c1"}');
  sources[0].emit("change", "garbage");
  sources[0].emit("ping", "{}");
  assert.equal(opens(), 1);
  assert.deepEqual(events, [{ type: "card.upserted", cardId: "c1" }]);
  connection.stop();
});

test("a quick reconnect never shows Reconnecting… and refetches on reopen", async () => {
  const { connection, clock, sources, reconnecting, opens } = setup();
  connection.start();
  sources[0].emit("open");
  sources[0].emit("error");
  assert.equal(sources[0].closed, true);
  await clock.advance(1_000);
  assert.equal(sources.length, 2, "reconnects after 1 s");
  sources[1].emit("open");
  await clock.advance(5_000);
  assert.deepEqual(reconnecting, []);
  assert.equal(opens(), 2);
  connection.stop();
});

test("a lasting outage shows Reconnecting… and backs off 1, 2, 4 s", async () => {
  const { connection, clock, sources, reconnecting } = setup();
  connection.start();
  sources[0].emit("error");
  await clock.advance(1_000);
  assert.equal(sources.length, 2);
  sources[1].emit("error");
  await clock.advance(500);
  assert.deepEqual(reconnecting, [true], "label after the 1.5 s grace");
  await clock.advance(1_499);
  assert.equal(sources.length, 2);
  await clock.advance(1);
  assert.equal(sources.length, 3, "second retry 2 s after the second error");
  sources[2].emit("error");
  await clock.advance(4_000);
  assert.equal(sources.length, 4, "third retry after 4 s");
  sources[3].emit("open");
  assert.deepEqual(reconnecting, [true, false]);
  connection.stop();
});

test("a silent stream (no ping for 60 s) is treated as dead", async () => {
  const { connection, clock, sources } = setup();
  connection.start();
  sources[0].emit("open");
  await clock.advance(59_000);
  sources[0].emit("ping", "{}");
  await clock.advance(59_000);
  assert.equal(sources[0].closed, false);
  await clock.advance(1_000);
  assert.equal(sources[0].closed, true);
  await clock.advance(1_000);
  assert.equal(sources.length, 2);
  connection.stop();
});

test("wake() skips the backoff; stop() ends everything", async () => {
  const { connection, clock, sources } = setup();
  connection.start();
  for (let i = 0; i < 4; i += 1) {
    sources[sources.length - 1].emit("error");
    await clock.advance(30_000);
  }
  sources[sources.length - 1].emit("error");
  const before = sources.length;
  connection.wake();
  assert.equal(sources.length, before + 1);
  connection.stop();
  assert.equal(sources[sources.length - 1].closed, true);
  await clock.advance(120_000);
  assert.equal(sources.length, before + 1);
  assert.equal(clock.pendingCount(), 0);
});
