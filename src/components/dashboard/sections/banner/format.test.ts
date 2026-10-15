import assert from "node:assert/strict";
import { test } from "node:test";
import { authorLabel, capRows, chunk, formatChange, formatClockOrDay, formatPrice, plural, sameCurrency } from "./format";

const zone = "America/Denver";
const now = new Date("2026-10-14T18:00:00Z"); // 12:00 MDT

test("a gain shows the arrow and a plus sign", () => {
  assert.deepEqual(formatChange(1.44), { direction: "up", text: "▲ +1.4%", spoken: "up 1.4 percent" });
});

test("a loss shows the arrow and a real minus sign", () => {
  const change = formatChange(-0.84);
  assert.equal(change.direction, "down");
  assert.equal(change.text, "▼ −0.8%");
  assert.notEqual(change.text, "▼ -0.8%");
  assert.equal(change.spoken, "down 0.8 percent");
});

test("a change that rounds to 0.0 is flat, whatever its sign", () => {
  for (const pct of [0, 0.04, -0.04, -0]) {
    const change = formatChange(pct);
    assert.equal(change.direction, "flat");
    assert.equal(change.text, "▬ 0.0%");
    assert.equal(change.spoken, "unchanged");
  }
});

test("0.05 rounds up to 0.1 and is no longer flat", () => {
  assert.equal(formatChange(0.06).text, "▲ +0.1%");
});

test("large six-month moves keep one decimal and group thousands", () => {
  assert.equal(formatChange(123.45).text, "▲ +123.5%");
  assert.equal(formatChange(-1234.56).text, "▼ −1,234.6%");
});

test("a non-finite change reads as flat instead of NaN%", () => {
  assert.equal(formatChange(Number.NaN).direction, "flat");
  assert.equal(formatChange(Number.POSITIVE_INFINITY).text, "▬ 0.0%");
});

test("prices have two decimals and thousands separators; sub-dollar prices get four", () => {
  assert.equal(formatPrice(181.2), "181.20");
  assert.equal(formatPrice(1234.5), "1,234.50");
  assert.equal(formatPrice(0.5), "0.5000");
  assert.equal(formatPrice(Number.NaN), "–");
});

test("sameCurrency returns the code only when every row agrees", () => {
  assert.equal(sameCurrency([{ currency: "USD" }, { currency: "USD" }]), "USD");
  assert.equal(sameCurrency([{ currency: "USD" }, { currency: "EUR" }]), null);
  assert.equal(sameCurrency([]), null);
});

test("chunk fills columns of three and leaves the last one short", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]]);
  assert.deepEqual(chunk([], 3), []);
});

test("capRows reports how many rows were left out", () => {
  assert.deepEqual(capRows([1, 2, 3], 4), { shown: [1, 2, 3], hidden: 0 });
  assert.deepEqual(capRows([1, 2, 3, 4, 5, 6], 4), { shown: [1, 2, 3, 4], hidden: 2 });
});

test("plural", () => {
  assert.equal(plural(1, "issue"), "1 issue");
  assert.equal(plural(0, "issue"), "0 issues");
  assert.equal(plural(6, "item"), "6 items");
});

test("the author line names hermes, you, github and the system", () => {
  assert.equal(authorLabel("hermes"), "Hermes");
  assert.equal(authorLabel("user"), "you");
  assert.equal(authorLabel("github"), "GitHub");
  assert.equal(authorLabel("system"), "system");
});

test("a time on the same local day is a bare clock in the dashboard zone", () => {
  assert.equal(formatClockOrDay(new Date("2026-10-14T14:00:00Z"), now, zone), "08:00");
});

test("a time from an earlier local day carries the day", () => {
  assert.equal(formatClockOrDay(new Date("2026-10-13T00:05:00Z"), now, zone), "Oct 12, 18:05");
});

test("local day, not UTC day, decides: 23:30 MDT the night before is yesterday", () => {
  assert.equal(formatClockOrDay(new Date("2026-10-14T05:30:00Z"), now, zone), "Oct 13, 23:30");
});

test("an invalid time renders as nothing", () => {
  assert.equal(formatClockOrDay(new Date("nope"), now, zone), "");
});
