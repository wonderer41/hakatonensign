import assert from "node:assert/strict";
import { test } from "node:test";
import { clockFromMinutes, clockFromServer, formatDuration, formatRange, parseClock, parseLength, wallMinutes } from "./format";

const zone = "America/Denver";

test("clock ↔ minutes", () => {
  assert.equal(clockFromMinutes(0), "00:00");
  assert.equal(clockFromMinutes(1140), "19:00");
  assert.equal(clockFromMinutes(1230), "20:30");
  assert.equal(clockFromMinutes(1470), "24:30");
  assert.equal(parseClock("19:00"), 1140);
  assert.equal(parseClock("7:05"), 425);
  assert.equal(parseClock("19:00:30"), 1140);
  assert.equal(parseClock(""), null);
  assert.equal(parseClock("24:00"), null);
  assert.equal(parseClock("12:60"), null);
  assert.equal(parseClock("noon"), null);
});

test("length is a free number rounded to whole minutes", () => {
  assert.equal(parseLength("47"), 47);
  assert.equal(parseLength(" 90 "), 90);
  assert.equal(parseLength("47.6"), 48);
  assert.equal(parseLength(""), null);
  assert.equal(parseLength("abc"), null);
  assert.equal(parseLength("-5"), -5);
});

test("readable length echo", () => {
  assert.equal(formatDuration(47), "47 min");
  assert.equal(formatDuration(60), "1 h");
  assert.equal(formatDuration(83), "1 h 23 min");
  assert.equal(formatDuration(90), "1 h 30 min");
  assert.equal(formatDuration(720), "12 h");
  assert.equal(formatDuration(0), "");
  assert.equal(formatDuration(-3), "");
  assert.equal(formatDuration(null), "");
});

test("wall minutes on the page's date (Denver, MDT)", () => {
  // 2026-10-14 19:00 MDT = 2026-10-15T01:00Z
  assert.equal(wallMinutes("2026-10-15T01:00:00Z", "2026-10-14", zone), 1140);
  assert.equal(wallMinutes("2026-10-14T05:00:00Z", "2026-10-14", zone), 0); // 23:00 the day before
  assert.equal(wallMinutes("2026-10-15T07:00:00Z", "2026-10-14", zone), 1440); // 01:00 the next day
});

test("wall minutes on the DST change day keep the wall clock", () => {
  // 2026-11-01 19:00 MST = 2026-11-02T02:00Z (the day has 25 hours)
  assert.equal(wallMinutes("2026-11-02T02:00:00Z", "2026-11-01", zone), 1140);
});

test("server clocks and ranges", () => {
  assert.equal(clockFromServer("20:30", zone), "20:30");
  assert.equal(clockFromServer("2026-10-15T02:30:00Z", zone), "20:30");
  assert.equal(formatRange("2026-10-15T01:00:00Z", "2026-10-15T02:30:00Z", zone), "19:00–20:30");
});
