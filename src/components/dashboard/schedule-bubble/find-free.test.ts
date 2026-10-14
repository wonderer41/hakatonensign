import assert from "node:assert/strict";
import { test } from "node:test";
import type { TimelineEventDto } from "@/types/dashboard-contracts";
import { busyRanges, findFree } from "./find-free";

// The mockup's calendar (local minutes).
const CAL = [
  { start: 480, end: 555 },
  { start: 600, end: 660 },
  { start: 780, end: 855 },
  { start: 930, end: 1110 }, // [Work shift] 15:30–18:30
  { start: 1140, end: 1230 }, // work block 19:00–20:30
  { start: 1260, end: 1290 },
];

test("free right away", () => {
  assert.equal(findFree(705, 60, CAL), 705);
});

test("skips over the work shift and the work block (spec: next free 1 h 30 min starts at 20:30?)", () => {
  // 16:00 for 90 min collides with the shift; 18:30–19:00 is too short; 20:30–21:00 too short; 21:30 is free.
  assert.equal(findFree(960, 90, CAL), 1290);
  // 30 minutes fit between the shift and the work block.
  assert.equal(findFree(960, 30, CAL), 1110);
});

test("input order doesn't matter", () => {
  assert.equal(findFree(960, 30, [...CAL].reverse()), 1110);
});

test("null when nothing is left before midnight", () => {
  assert.equal(findFree(1300, 200, CAL), null);
  assert.equal(findFree(1290, 150, CAL), 1290);
  assert.equal(findFree(1290, 151, CAL), null);
});

test("events that ended before the start are ignored", () => {
  assert.equal(findFree(1235, 20, CAL), 1235);
});

function event(partial: Partial<TimelineEventDto> & Pick<TimelineEventDto, "startsAt" | "endsAt">): TimelineEventDto {
  return {
    id: partial.startsAt,
    title: "x",
    allDay: false,
    kind: "calendar",
    state: "future",
    checklistItemId: null,
    alertId: null,
    htmlLink: null,
    ...partial,
  };
}

test("busy ranges from the page's timeline (Denver)", () => {
  const events = [
    event({ startsAt: "2026-10-14T06:00:00Z", endsAt: "2026-10-15T06:00:00Z", allDay: true }),
    event({ startsAt: "2026-10-14T21:30:00Z", endsAt: "2026-10-15T00:30:00Z" }), // 15:30–18:30
    event({ startsAt: "2026-10-15T01:00:00Z", endsAt: "2026-10-15T02:30:00Z", kind: "work_block", checklistItemId: "item-12" }),
    event({ startsAt: "2026-10-15T05:30:00Z", endsAt: "2026-10-15T07:00:00Z" }), // 23:30–01:00 next day
  ];
  assert.deepEqual(busyRanges(events, "2026-10-14", "America/Denver"), [
    { start: 930, end: 1110 },
    { start: 1140, end: 1230 },
    { start: 1410, end: 1440 },
  ]);
  // Rescheduling item-12 ignores its own block.
  assert.deepEqual(busyRanges(events, "2026-10-14", "America/Denver", { checklistItemId: "item-12" }), [
    { start: 930, end: 1110 },
    { start: 1410, end: 1440 },
  ]);
});
