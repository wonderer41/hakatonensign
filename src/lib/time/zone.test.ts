import assert from "node:assert/strict";
import test from "node:test";
import { addDays, datesSpanned, dayBounds, formatClock, formatEyebrowDate, isDateString, localDateString, zonedTimeToUtc } from "./zone";

const DENVER = "America/Denver";

test("date strings must be real calendar dates", () => {
  assert.equal(isDateString("2026-10-12"), true);
  assert.equal(isDateString("2026-02-29"), false);
  assert.equal(isDateString("2026-13-01"), false);
  assert.equal(isDateString("2026-10-12T00:00"), false);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("a normal Denver day is 24 hours starting at local midnight", () => {
  const { start, end } = dayBounds("2026-10-12", DENVER);
  assert.equal(start.toISOString(), "2026-10-12T06:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-13T06:00:00.000Z");
});

test("DST days are 23 and 25 hours long in Denver", () => {
  const spring = dayBounds("2026-03-08", DENVER);
  assert.equal(spring.start.toISOString(), "2026-03-08T07:00:00.000Z");
  assert.equal((spring.end.getTime() - spring.start.getTime()) / 3_600_000, 23);

  const fall = dayBounds("2026-11-01", DENVER);
  assert.equal(fall.start.toISOString(), "2026-11-01T06:00:00.000Z");
  assert.equal((fall.end.getTime() - fall.start.getTime()) / 3_600_000, 25);
});

test("local wall-clock conversions round-trip in the dashboard zone", () => {
  const sevenPm = zonedTimeToUtc("2026-10-12", 19 * 60, DENVER);
  assert.equal(sevenPm.toISOString(), "2026-10-13T01:00:00.000Z");
  assert.equal(localDateString(sevenPm, DENVER), "2026-10-12");
  assert.equal(formatClock(sevenPm, DENVER), "19:00");
  assert.equal(formatEyebrowDate(sevenPm, DENVER), "MONDAY · OCTOBER 12");
});

test("datesSpanned lists every local date an event touches, end exclusive", () => {
  const start = zonedTimeToUtc("2026-10-12", 22 * 60, DENVER);
  const end = zonedTimeToUtc("2026-10-13", 2 * 60, DENVER);
  assert.deepEqual(datesSpanned(start, end, DENVER), ["2026-10-12", "2026-10-13"]);

  const allDay = dayBounds("2026-10-12", DENVER);
  assert.deepEqual(datesSpanned(allDay.start, allDay.end, DENVER), ["2026-10-12"]);
});
