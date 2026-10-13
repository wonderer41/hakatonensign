import assert from "node:assert/strict";
import test from "node:test";
import { zonedTimeToUtc } from "@/lib/time/zone";
import { buildTimeline, gapTone, NOW_MARKER_ID, type TimelineSourceEvent } from "./build";

const DENVER = "America/Denver";
const DATE = "2026-10-12";
const at = (hhmm: string, date = DATE) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTimeToUtc(date, h * 60 + m, DENVER);
};

function event(id: string, start: string, end: string, extra: Partial<TimelineSourceEvent> = {}): TimelineSourceEvent {
  return {
    id,
    title: id,
    startsAt: at(start),
    endsAt: at(end),
    allDay: false,
    kind: "calendar",
    checklistItemId: null,
    alertId: null,
    htmlLink: null,
    ...extra,
  };
}

const build = (events: TimelineSourceEvent[], now = at("11:45")) =>
  buildTimeline({ date: DATE, timeZone: DENVER, now, events, lastSyncAt: null, syncError: null });

test("gap tones follow the spec thresholds", () => {
  assert.equal(gapTone(-5), "overlap");
  assert.equal(gapTone(0), "short");
  assert.equal(gapTone(29), "short");
  assert.equal(gapTone(30), "medium");
  assert.equal(gapTone(60), "medium");
  assert.equal(gapTone(61), "long");
});

test("the mockup's day yields its gaps, states and now marker", () => {
  const timeline = build([
    event("class", "08:00", "09:15"),
    event("event", "10:00", "11:00"),
    event("class2", "13:00", "14:15"),
    event("shift", "15:30", "18:30"),
    event("block", "19:00", "20:30", { kind: "work_block" }),
    event("late", "21:00", "21:30"),
  ]);

  assert.deepEqual(
    timeline.events.map((e) => [e.id, e.state]),
    [["class", "past"], ["event", "past"], ["class2", "future"], ["shift", "future"], ["block", "future"], ["late", "future"]],
  );
  assert.deepEqual(
    timeline.gaps.map((g) => [g.afterEventId, g.minutes, g.tone]),
    [
      ["class", 45, "medium"],
      ["event", 45, "medium"],
      [NOW_MARKER_ID, 75, "long"],
      ["class2", 75, "long"],
      ["shift", 30, "medium"],
      ["block", 30, "medium"],
    ],
  );
});

test("overlapping events are flagged and nested events measure from the latest end", () => {
  const timeline = build(
    [event("long", "09:00", "17:00"), event("inside", "10:00", "11:00"), event("after", "17:30", "18:00")],
    at("08:00", "2026-10-13"),
  );
  assert.deepEqual(
    timeline.gaps.map((g) => [g.afterEventId, g.minutes, g.tone]),
    [
      ["long", -420, "overlap"],
      ["inside", 30, "medium"],
    ],
  );
});

test("a now marker inside an event adds no gap of its own", () => {
  const timeline = build([event("meeting", "11:00", "12:30"), event("next", "13:00", "14:00")], at("11:45"));
  assert.equal(timeline.events[0].state, "current");
  assert.deepEqual(
    timeline.gaps.map((g) => [g.afterEventId, g.minutes]),
    [[NOW_MARKER_ID, 30]],
  );
});

test("all-day events are listed separately and events outside the day are dropped", () => {
  const timeline = build([
    event("holiday", "00:00", "00:00", { allDay: true, endsAt: at("00:00", "2026-10-13") }),
    event("yesterday", "08:00", "09:00", { startsAt: at("08:00", "2026-10-11"), endsAt: at("09:00", "2026-10-11") }),
    event("today", "08:00", "09:00"),
  ]);
  assert.deepEqual(timeline.allDay.map((e) => e.id), ["holiday"]);
  assert.deepEqual(timeline.events.map((e) => e.id), ["today"]);
});

test("other days get no now marker", () => {
  const timeline = build([event("a", "08:00", "09:00"), event("b", "10:00", "11:00")], at("12:00", "2026-10-11"));
  assert.deepEqual(timeline.gaps.map((g) => g.afterEventId), ["a"]);
  assert.ok(timeline.events.every((e) => e.state === "future"));
});
