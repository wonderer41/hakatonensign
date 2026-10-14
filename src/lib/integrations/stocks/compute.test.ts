import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRow,
  buildSnapshot,
  formatChange,
  sixMonthChangePct,
  sixMonthsBefore,
} from "./compute";
import { parseFinnhubQuote } from "./finnhub";
import { fetchTiingoPrices, parseTiingoPrices } from "./tiingo";

test("sixMonthsBefore subtracts six calendar months and clamps the day", () => {
  assert.equal(sixMonthsBefore("2026-10-14"), "2026-04-14");
  assert.equal(sixMonthsBefore("2026-03-31"), "2025-09-30");
  assert.equal(sixMonthsBefore("2026-08-31"), "2026-02-28");
  assert.equal(sixMonthsBefore("2028-08-31"), "2028-02-29");
  assert.equal(sixMonthsBefore("2026-01-15"), "2025-07-15");
});

test("sixMonthChangePct uses the first trading day on/after the start date", () => {
  const prices = [
    { date: "2026-04-10", adjClose: 50 },
    { date: "2026-04-15", adjClose: 100 }, // 04-14 is a gap; first on/after
    { date: "2026-07-01", adjClose: 120 },
    { date: "2026-10-13", adjClose: 150 },
  ];
  assert.equal(sixMonthChangePct(prices, "2026-10-14"), 50);
  assert.equal(sixMonthChangePct([...prices].reverse(), "2026-10-14"), 50);
});

test("sixMonthChangePct handles losses, empty series and no base", () => {
  assert.equal(sixMonthChangePct([{ date: "2026-04-14", adjClose: 200 }, { date: "2026-10-13", adjClose: 150 }], "2026-10-14"), -25);
  assert.equal(sixMonthChangePct([], "2026-10-14"), null);
  assert.equal(sixMonthChangePct([{ date: "2026-04-14", adjClose: 0 }, { date: "2026-10-13", adjClose: 5 }], "2026-10-14"), null);
  assert.equal(sixMonthChangePct([{ date: "2026-03-01", adjClose: 10 }], "2026-10-14"), null);
});

test("buildSnapshot keeps watchlist order and drops failed symbols", () => {
  const quote = { price: 10, dayChangePct: 1 };
  const rows = [buildRow("B", quote, 5), buildRow("A", quote, 6)];
  const snapshot = buildSnapshot(["A", "X", "B"], rows, new Date("2026-10-14T16:00:00Z"));
  assert.deepEqual(snapshot.rows.map((row) => row.symbol), ["A", "B"]);
  assert.equal(snapshot.asOf, "2026-10-14T16:00:00.000Z");
  assert.equal(snapshot.rows[0].currency, "USD");
});

test("formatChange shows arrows and a true minus sign", () => {
  assert.equal(formatChange(1.234), "▲ +1.2%");
  assert.equal(formatChange(-3.46), "▼ −3.5%");
  assert.equal(formatChange(0), "▲ +0.0%");
  assert.equal(formatChange(-0.01), "▲ +0.0%");
});

test("parseFinnhubQuote reads c and dp and rejects empty quotes", () => {
  assert.deepEqual(parseFinnhubQuote("NVDA", { c: 120.5, dp: -1.2, t: 1700000000 }), { price: 120.5, dayChangePct: -1.2 });
  assert.throws(() => parseFinnhubQuote("NOPE", { c: 0, d: null, dp: null, t: 0 }), /no quote for NOPE/);
  assert.throws(() => parseFinnhubQuote("X", { c: 10, dp: null, t: 1 }), /no day change/);
});

test("parseTiingoPrices sorts ascending and trims timestamps", () => {
  const prices = parseTiingoPrices("NVDA", [
    { date: "2026-10-13T00:00:00.000Z", adjClose: 2 },
    { date: "2026-04-14T00:00:00.000Z", adjClose: 1 },
    { date: "2026-05-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(prices, [
    { date: "2026-04-14", adjClose: 1 },
    { date: "2026-10-13", adjClose: 2 },
  ]);
  assert.throws(() => parseTiingoPrices("X", { detail: "Not found" }), /unexpected body/);
});

test("fetchTiingoPrices sends the key in a header, not the URL, and reports HTTP errors", async () => {
  let seenUrl = "";
  let seenAuth = "";
  const ok = (async (url: URL, init: RequestInit) => {
    seenUrl = String(url);
    seenAuth = (init.headers as Record<string, string>).Authorization;
    return new Response(JSON.stringify([{ date: "2026-04-14T00:00:00.000Z", adjClose: 1 }]));
  }) as unknown as typeof fetch;
  await fetchTiingoPrices("NVDA", "2026-04-14", { apiKey: "secret" }, ok);
  assert.match(seenUrl, /NVDA\/prices\?startDate=2026-04-14$/);
  assert.equal(seenAuth, "Token secret");

  const bad = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(fetchTiingoPrices("NVDA", "2026-04-14", { apiKey: "secret" }, bad), (error: Error) => {
    assert.match(error.message, /HTTP 429/);
    assert.ok(!error.message.includes("secret"));
    return true;
  });
});
