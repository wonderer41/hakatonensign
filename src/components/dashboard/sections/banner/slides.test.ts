import assert from "node:assert/strict";
import { test } from "node:test";
import type { BannerDto } from "@/types/dashboard-contracts";
import { availableSlides, oldestSlide } from "./slides";

const gmail = { since: "2026-10-14T14:00:00Z", needsReply: [], packages: [], payments: [], deletedCount: 0 };
const orphans = { items: [], counts: { sonarr: 0, radarr: 0 } };
const scan = { ranAt: "2026-10-14T12:00:00Z", up: 1, total: 1, issues: [] };
const stocks = { asOf: "2026-10-14T17:40:00Z", rows: [{ symbol: "NVDA", price: 181.2, currency: "USD", dayChangePct: 1.4, sixMonthChangePct: 22.5 }] };

const empty: BannerDto = { dailyMessage: null, gmail: null, orphans: null, scan: null, stocks: null };
const full: BannerDto = {
  dailyMessage: { date: "2026-10-14", text: "Ship the banner.", author: "user" },
  gmail: { capturedAt: "2026-10-14T17:30:00Z", data: gmail },
  orphans: { capturedAt: "2026-10-14T12:15:00Z", data: orphans },
  scan: { capturedAt: "2026-10-14T12:00:00Z", data: scan },
  stocks: { capturedAt: "2026-10-14T17:40:00Z", data: stocks },
};

test("all four slides show in order when every part has data", () => {
  assert.deepEqual(availableSlides(full), ["message", "gmail", "infra", "stocks"]);
});

test("slides with no data are skipped", () => {
  assert.deepEqual(availableSlides({ ...full, gmail: null, stocks: null }), ["message", "infra"]);
  assert.deepEqual(availableSlides(empty), []);
});

test("a blank daily message counts as no message", () => {
  assert.deepEqual(availableSlides({ ...full, dailyMessage: { date: "2026-10-14", text: "  \n", author: "hermes" } }), ["gmail", "infra", "stocks"]);
});

test("the orphans + scan slide shows with either half alone", () => {
  assert.deepEqual(availableSlides({ ...empty, orphans: full.orphans }), ["infra"]);
  assert.deepEqual(availableSlides({ ...empty, scan: full.scan }), ["infra"]);
});

test("a stocks snapshot without rows is skipped", () => {
  assert.deepEqual(availableSlides({ ...empty, stocks: { capturedAt: "2026-10-14T17:40:00Z", data: { asOf: "2026-10-14T17:40:00Z", rows: [] } } }), []);
});

test("the oldest snapshot picks the slide; orphans + scan count by their older half", () => {
  const ids = availableSlides(full);
  assert.deepEqual(oldestSlide(full, ids), { id: "infra", capturedAt: "2026-10-14T12:00:00Z" });
});

test("the daily message never counts as a snapshot", () => {
  const banner: BannerDto = { ...empty, dailyMessage: full.dailyMessage, gmail: full.gmail };
  assert.deepEqual(oldestSlide(banner, availableSlides(banner)), { id: "gmail", capturedAt: "2026-10-14T17:30:00Z" });
});

test("a lone snapshot slide is the oldest", () => {
  const banner: BannerDto = { ...empty, stocks: full.stocks };
  assert.deepEqual(oldestSlide(banner, availableSlides(banner)), { id: "stocks", capturedAt: "2026-10-14T17:40:00Z" });
});

test("equal times go to the earlier slide", () => {
  const same = "2026-10-14T12:00:00Z";
  const banner: BannerDto = { ...empty, gmail: { capturedAt: same, data: gmail }, stocks: { capturedAt: same, data: stocks } };
  assert.equal(oldestSlide(banner, availableSlides(banner))?.id, "gmail");
});

test("only slides that are shown are compared", () => {
  assert.equal(oldestSlide(full, ["message", "gmail"])?.id, "gmail");
});

test("nothing to compare without a snapshot", () => {
  assert.equal(oldestSlide(empty, []), null);
  const banner: BannerDto = { ...empty, dailyMessage: full.dailyMessage };
  assert.equal(oldestSlide(banner, availableSlides(banner)), null);
});
