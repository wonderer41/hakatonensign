import assert from "node:assert/strict";
import { test } from "node:test";
import type { TodayResponse } from "@/types/dashboard-contracts";
import { fakeTimers, flush } from "./test-timers";
import { TodayFeed, todayUrl, type FeedView } from "./today-feed";

function today(date: string, tag = ""): TodayResponse {
  return { date, generatedAt: tag } as TodayResponse;
}

interface Call {
  url: string;
  signal: AbortSignal;
  resolve: (value: TodayResponse) => void;
  reject: (error: unknown) => void;
}

function setup(view: FeedView = { date: "2026-10-14", pinned: false }) {
  const clock = fakeTimers();
  const calls: Call[] = [];
  const data: Array<{ today: TodayResponse; view: FeedView }> = [];
  const errors: number[] = [];
  const feed = new TodayFeed({
    view,
    timers: clock.timers,
    load: (url, signal) =>
      new Promise<TodayResponse>((resolve, reject) => {
        calls.push({ url, signal, resolve, reject });
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    onData: (value, nextView) => data.push({ today: value, view: nextView }),
    onError: (_error, retryInMs) => errors.push(retryInMs),
  });
  return { feed, clock, calls, data, errors };
}

test("todayUrl asks the server for today unless the URL pinned a date", () => {
  assert.equal(todayUrl({ date: "2026-10-14", pinned: false }), "/api/today");
  assert.equal(todayUrl({ date: "2026-10-01", pinned: true }), "/api/today?date=2026-10-01");
});

test("a burst of refreshes becomes one request, 300 ms after the last", async () => {
  const { feed, clock, calls } = setup();
  void feed.request();
  await clock.advance(100);
  void feed.request();
  await clock.advance(100);
  void feed.request();
  await clock.advance(299);
  assert.equal(calls.length, 0);
  await clock.advance(1);
  assert.equal(calls.length, 1);
});

test("a steady stream of refreshes still fetches within the 1 s max wait", async () => {
  const { feed, clock, calls } = setup();
  for (let i = 0; i < 6; i += 1) {
    void feed.request();
    await clock.advance(200);
  }
  assert.equal(calls.length, 1, "fetched once the first ask was 1 s old");
});

test("a newer request aborts the one in flight; everyone waiting is answered by the newer one", async () => {
  const { feed, clock, calls, data } = setup();
  let firstSettled = false;
  void feed.request({ immediate: true }).then(() => (firstSettled = true));
  await clock.advance(0);
  const second = feed.request({ immediate: true });
  await clock.advance(0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
  await flush();
  assert.equal(firstSettled, false, "the first caller waits for the replacement request");
  calls[1].resolve(today("2026-10-14", "second"));
  await second;
  await flush();
  assert.equal(firstSettled, true);
  assert.deepEqual(
    data.map((entry) => entry.today.generatedAt),
    ["second"],
  );
});

test("a page that follows today adopts the server's date; a pinned page keeps its own", async () => {
  const following = setup({ date: "2026-10-14", pinned: false });
  void following.feed.request({ immediate: true });
  await following.clock.advance(0);
  following.calls[0].resolve(today("2026-10-15"));
  await flush();
  assert.deepEqual(following.data[0].view, { date: "2026-10-15", pinned: false });
  assert.deepEqual(following.feed.currentView, { date: "2026-10-15", pinned: false });

  const pinned = setup({ date: "2026-10-01", pinned: true });
  void pinned.feed.request({ immediate: true });
  await pinned.clock.advance(0);
  assert.equal(pinned.calls[0].url, "/api/today?date=2026-10-01");
  pinned.calls[0].resolve(today("2026-10-01"));
  await flush();
  assert.deepEqual(pinned.data[0].view, { date: "2026-10-01", pinned: true });
});

test("setView loads the new day at once", async () => {
  const { feed, clock, calls } = setup({ date: "2026-10-14", pinned: false });
  void feed.setView({ date: "2026-10-15", pinned: false });
  await clock.advance(0);
  assert.equal(calls.length, 1);
});

test("a failed refresh retries with backoff and recovers", async () => {
  const { feed, clock, calls, data, errors } = setup();
  const settled = feed.request({ immediate: true });
  await clock.advance(0);
  calls[0].reject(new Error("offline"));
  await settled;
  assert.deepEqual(errors, [1_000]);

  await clock.advance(999);
  assert.equal(calls.length, 1);
  await clock.advance(1);
  assert.equal(calls.length, 2);
  calls[1].reject(new Error("still offline"));
  await flush();
  assert.deepEqual(errors, [1_000, 2_000]);

  await clock.advance(2_000);
  calls[2].resolve(today("2026-10-14"));
  await flush();
  assert.equal(data.length, 1);
  assert.equal(clock.pendingCount(), 0, "no retry left once it worked");
});

test("dispose aborts the request in flight and answers every waiter", async () => {
  const { feed, clock, calls, data } = setup();
  const waiting = feed.request({ immediate: true });
  await clock.advance(0);
  feed.dispose();
  await waiting;
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(data.length, 0);
  await feed.request();
  assert.equal(calls.length, 1, "a disposed feed never fetches again");
});
