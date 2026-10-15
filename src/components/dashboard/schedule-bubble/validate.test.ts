import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDraft, defaultLength, defaultStart, draftEcho, MESSAGES } from "./validate";

const NOW = 11 * 60 + 45; // 11:45, the spec's example

test("a valid draft today", () => {
  assert.deepEqual(checkDraft({ start: "19:00", length: "90" }, "today", NOW), { ok: true, start: "19:00", startMin: 1140, durationMin: 90 });
  // Starting exactly now is fine; ending exactly at midnight is fine.
  assert.equal(checkDraft({ start: "11:45", length: "30" }, "today", NOW).ok, true);
  assert.equal(checkDraft({ start: "23:00", length: "60" }, "today", NOW).ok, true);
});

test("missing start", () => {
  assert.deepEqual(checkDraft({ start: "", length: "90" }, "today", NOW), { ok: false, field: "start", message: MESSAGES.noStart });
});

test("invalid length: empty, zero, negative, not a number", () => {
  for (const length of ["", "0", "-5", "abc", "0.4"]) {
    assert.deepEqual(checkDraft({ start: "19:00", length }, "today", NOW), {
      ok: false,
      field: "length",
      message: "Give me a length of at least 1 minute.",
    });
  }
});

test("any length from 1 to 720, e.g. 47", () => {
  assert.equal(checkDraft({ start: "12:00", length: "1" }, "today", NOW).ok, true);
  assert.equal(checkDraft({ start: "12:00", length: "47" }, "today", NOW).ok, true);
  assert.equal(checkDraft({ start: "11:50", length: "720" }, "today", NOW).ok, true);
  assert.deepEqual(checkDraft({ start: "06:00", length: "721" }, "future", NOW), { ok: false, field: "length", message: MESSAGES.tooLong });
});

test("past time today names the current time", () => {
  assert.deepEqual(checkDraft({ start: "09:00", length: "30" }, "today", NOW), {
    ok: false,
    field: "start",
    message: "That time already passed today. Pick something after 11:45.",
  });
  // Another day has no "now".
  assert.equal(checkDraft({ start: "09:00", length: "30" }, "future", NOW).ok, true);
});

test("a past day can't be booked", () => {
  assert.deepEqual(checkDraft({ start: "19:00", length: "30" }, "past", NOW), { ok: false, field: "start", message: MESSAGES.pastDay });
});

test("past midnight", () => {
  assert.deepEqual(checkDraft({ start: "23:30", length: "45" }, "today", NOW), {
    ok: false,
    field: "start",
    message: "That runs past midnight. Try an earlier start.",
  });
});

test("Gerardo's own message", () => {
  assert.equal(draftEcho({ start: "19:00", length: "90" }), "19:00–20:30 (1 h 30 min)");
  assert.equal(draftEcho({ start: "19:00", length: "47" }), "19:00–19:47 (47 min)");
  assert.equal(draftEcho({ start: "", length: "90" }), "No time set");
  assert.equal(draftEcho({ start: "19:00", length: "" }), "19:00, no length");
  assert.equal(draftEcho({ start: "23:30", length: "60" }), "23:30–24:30 (1 h)");
});

test("form defaults", () => {
  assert.equal(defaultStart("today", NOW, null), "19:00");
  assert.equal(defaultStart("future", 22 * 60, null), "19:00");
  // After 19:00 today: the next quarter hour.
  assert.equal(defaultStart("today", 19 * 60 + 2, null), "19:15");
  assert.equal(defaultStart("today", 19 * 60 + 15, null), "19:30");
  assert.equal(defaultStart("today", 23 * 60 + 58, null), "23:45");
  // Rescheduling starts from the current booking while it is still ahead.
  assert.equal(defaultStart("today", NOW, 20 * 60), "20:00");
  assert.equal(defaultStart("today", 21 * 60, 20 * 60), "21:15");
  assert.equal(defaultLength(null), "90");
  assert.equal(defaultLength(45), "45");
  assert.equal(defaultLength(900), "90");
});
