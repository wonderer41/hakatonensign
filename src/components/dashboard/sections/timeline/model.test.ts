import assert from "node:assert/strict";
import { test } from "node:test";
import { NOW_MARKER_ID } from "@/lib/timeline/build";
import { zonedTimeToUtc } from "@/lib/time/zone";
import type { TimelineEventDto, TimelineResponse } from "@/types/dashboard-contracts";
import { buildTimelineView, cardState, dayRelation, formatGap, nowMarkerIndex, sourceWord } from "./model";

const ZONE = "America/Denver";
const DATE = "2026-10-12";
const at = (hhmm: string, date = DATE) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTimeToUtc(date, h * 60 + m, ZONE).toISOString();
};

function event(id: string, start: string, end: string, extra: Partial<TimelineEventDto> = {}): TimelineEventDto {
  return {
    id,
    title: id,
    startsAt: at(start),
    endsAt: at(end),
    allDay: false,
    kind: "calendar",
    state: "future",
    checklistItemId: null,
    alertId: null,
    htmlLink: null,
    ...extra,
  };
}

function timeline(events: TimelineEventDto[], allDay: TimelineEventDto[] = []): TimelineResponse {
  return { date: DATE, timeZone: ZONE, now: at("00:00"), allDay, events, gaps: [], lastSyncAt: null, syncError: null };
}

// The mockup's day, with the clock at 11:45.
const MOCKUP = [
  event("class", "08:00", "09:15"),
  event("event", "10:00", "11:00"),
  event("class2", "13:00", "14:15"),
  event("shift", "15:30", "18:30"),
  event("block", "19:00", "20:30", { kind: "work_block" }),
  event("late", "21:00", "21:30"),
];

test("gap labels: minutes, hours and minutes, whole hours, overlap", () => {
  assert.equal(formatGap(0), "0m");
  assert.equal(formatGap(36), "36m");
  assert.equal(formatGap(59), "59m");
  assert.equal(formatGap(60), "1h");
  assert.equal(formatGap(81), "1h 21m");
  assert.equal(formatGap(120), "2h");
  assert.equal(formatGap(-15), "overlap");
});

test("the now marker goes before the first event starting at or after now; a tie puts it first", () => {
  assert.equal(nowMarkerIndex(MOCKUP, Date.parse(at("11:45"))), 2);
  assert.equal(nowMarkerIndex(MOCKUP, Date.parse(at("13:00"))), 2);
  assert.equal(nowMarkerIndex(MOCKUP, Date.parse(at("07:00"))), 0);
  assert.equal(nowMarkerIndex(MOCKUP, Date.parse(at("23:00"))), MOCKUP.length);
  // Inside an event: after the event that started already.
  assert.equal(nowMarkerIndex(MOCKUP, Date.parse(at("16:00"))), 4);
  assert.equal(nowMarkerIndex([], Date.parse(at("12:00"))), 0);
});

test("day relation compares local dates in the zone", () => {
  // 23:30 in Denver on Oct 12 is already Oct 13 in UTC.
  const lateEvening = new Date(at("23:30"));
  assert.equal(dayRelation("2026-10-12", lateEvening, ZONE), "today");
  assert.equal(dayRelation("2026-10-11", lateEvening, ZONE), "past");
  assert.equal(dayRelation("2026-10-13", lateEvening, ZONE), "future");
});

test("card state: by the clock today, all done on a past day, never dimmed on a future day", () => {
  const card = event("x", "10:00", "11:00");
  assert.equal(cardState(card, Date.parse(at("09:00")), "today"), "future");
  assert.equal(cardState(card, Date.parse(at("10:00")), "today"), "current");
  assert.equal(cardState(card, Date.parse(at("11:00")), "today"), "past");
  assert.equal(cardState(card, Date.parse(at("09:00")), "past"), "past");
  assert.equal(cardState(card, Date.parse(at("12:00")), "future"), "future");
});

test("source words: calendar, done, via hermes (+ done once it is over)", () => {
  assert.equal(sourceWord("calendar", "future"), "calendar");
  assert.equal(sourceWord("calendar", "current"), "calendar");
  assert.equal(sourceWord("calendar", "past"), "done");
  assert.equal(sourceWord("work_block", "future"), "via hermes");
  assert.equal(sourceWord("work_block", "past"), "via hermes · done");
});

test("the mockup's day: cards, now marker, gaps and markers", () => {
  const view = buildTimelineView(timeline(MOCKUP), at("11:45"), DATE, ZONE);
  assert.equal(view.relation, "today");
  assert.equal(view.eventCount, 6);
  assert.deepEqual(
    view.items.map((item) => [item.id, item.type === "event" ? `${item.start}–${item.end}` : item.time, item.marker, item.gap?.label ?? null]),
    [
      ["class", "08:00–09:15", "past", "45m"],
      ["event", "10:00–11:00", "past", "45m"],
      [NOW_MARKER_ID, "11:45", "now", "1h 15m"],
      ["class2", "13:00–14:15", "future", "1h 15m"],
      ["shift", "15:30–18:30", "future", "30m"],
      ["block", "19:00–20:30", "work-block", "30m"],
      ["late", "21:00–21:30", "future", null],
    ],
  );
  assert.deepEqual(
    view.items.map((item) => (item.type === "event" ? item.source : "now")),
    ["done", "done", "now", "calendar", "calendar", "via hermes", "calendar"],
  );
  assert.deepEqual(
    view.items.map((item) => item.gap?.tone ?? null),
    ["medium", "medium", "long", "long", "medium", "medium", null],
  );
});

test("the minute clock moves the now marker and its gaps without a refetch", () => {
  const view = buildTimelineView(timeline(MOCKUP), at("12:40"), DATE, ZONE);
  const now = view.items.find((item) => item.type === "now");
  assert.equal(now?.type === "now" ? now.time : null, "12:40");
  assert.deepEqual(
    view.items.slice(1, 3).map((item) => [item.id, item.gap?.minutes, item.gap?.tone]),
    [
      ["event", 100, "long"],
      [NOW_MARKER_ID, 20, "short"],
    ],
  );
});

test("a now marker inside an event has no gap leading to it; overlaps read 'overlap'", () => {
  const view = buildTimelineView(
    timeline([event("long", "09:00", "17:00"), event("inside", "10:00", "11:00"), event("after", "17:30", "18:00")]),
    at("10:30"),
    DATE,
    ZONE,
  );
  assert.deepEqual(
    view.items.map((item) => [item.id, item.type === "event" ? item.state : "now", item.gap?.label ?? null]),
    [
      ["long", "current", "overlap"],
      ["inside", "current", null],
      [NOW_MARKER_ID, "now", "30m"],
      ["after", "future", null],
    ],
  );
  assert.equal(view.items[0].gap?.description, "overlaps the next item");
  assert.equal(view.items[2].gap?.description, "30m free before the next item");
});

test("another day: no now marker; a past day is all done, a future day is not dimmed", () => {
  const past = buildTimelineView(timeline(MOCKUP), at("11:45", "2026-10-14"), DATE, ZONE);
  assert.equal(past.relation, "past");
  assert.ok(past.items.every((item) => item.type === "event" && item.state === "past"));
  assert.equal(past.items.find((item) => item.id === "block")?.marker, "work-block");
  assert.equal(past.items[0].gap?.label, "45m");

  const future = buildTimelineView(timeline(MOCKUP), at("11:45", "2026-10-10"), DATE, ZONE);
  assert.equal(future.relation, "future");
  assert.ok(future.items.every((item) => item.type === "event" && item.state === "future"));
  assert.equal(future.items.length, MOCKUP.length);
});

test("all-day events are counted and follow the day's state; an empty today still places the marker", () => {
  const holiday = event("holiday", "00:00", "00:00", { allDay: true, endsAt: at("00:00", "2026-10-13") });
  const today = buildTimelineView(timeline([], [holiday]), at("09:00"), DATE, ZONE);
  assert.equal(today.eventCount, 1);
  assert.deepEqual(today.allDay, [{ id: "holiday", title: "holiday", state: "current" }]);
  assert.deepEqual(
    today.items.map((item) => item.id),
    [NOW_MARKER_ID],
  );

  const pastDay = buildTimelineView(timeline([], [holiday]), at("09:00", "2026-10-13"), DATE, ZONE);
  assert.equal(pastDay.allDay[0].state, "past");
  assert.equal(buildTimelineView(timeline([]), at("09:00"), DATE, ZONE).eventCount, 0);
});
