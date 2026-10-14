import assert from "node:assert/strict";
import { test } from "node:test";
import type { SeerrRequestDto, TodayResponse, WaitingDto } from "@/types/dashboard-contracts";
import { ApiRequestError } from "../../api";
import {
  blockTag,
  decisionFailure,
  gmailLine,
  initialSeerrList,
  mergeRequestRows,
  moreInSeerr,
  outcomeText,
  requestErrorText,
  requestMeta,
  requestTitle,
  SEERR_RETRY_TEXT,
  seasonsLabel,
  seerrListReducer,
  seerrSummary,
  waitingVisibility,
  withSeerrPendingAtMost,
} from "./format";

const zone = "America/Denver";

function request(id: number, overrides: Partial<SeerrRequestDto> = {}): SeerrRequestDto {
  return {
    id,
    title: `Title ${id}`,
    year: 2001,
    mediaType: "movie",
    seasons: null,
    requestedBy: "maria",
    createdAt: "2026-10-13T02:14:05.000Z",
    ...overrides,
  };
}

function waiting(overrides: Partial<WaitingDto> = {}): WaitingDto {
  return {
    gmailNeedsReply: 0,
    seerrPending: 0,
    orphans: { sonarr: 0, radarr: 0, sonarrUrl: null, radarrUrl: null },
    seerrUrl: null,
    ...overrides,
  };
}

test("counts read naturally", () => {
  assert.equal(gmailLine(1), "1 starred thread needs a reply");
  assert.equal(gmailLine(3), "3 starred threads need a reply");
  assert.equal(seerrSummary(1), "1 guest request to approve");
  assert.equal(seerrSummary(2), "2 guest requests to approve");
  assert.equal(seerrSummary(0), "No requests waiting");
  assert.equal(seerrSummary(null), "? guest requests to approve");
});

test("seasons collapse into ranges; season 0 is specials", () => {
  assert.equal(seasonsLabel(null), null);
  assert.equal(seasonsLabel([]), null);
  assert.equal(seasonsLabel([1]), "season 1");
  assert.equal(seasonsLabel([3, 1, 2]), "seasons 1–3");
  assert.equal(seasonsLabel([1, 2, 5, 7, 8]), "seasons 1–2, 5, 7–8");
  assert.equal(seasonsLabel([0]), "specials");
  assert.equal(seasonsLabel([0, 1, 2]), "specials + seasons 1–2");
});

test("request rows: title (year), type, seasons, requester", () => {
  assert.equal(requestTitle(request(1, { title: "The Matrix", year: 1999 })), "The Matrix (1999)");
  assert.equal(requestTitle(request(1, { title: "TMDB #603", year: null })), "TMDB #603");
  assert.equal(requestMeta(request(1)), "Movie · requested by maria");
  assert.equal(requestMeta(request(2, { mediaType: "tv", seasons: [1, 2], requestedBy: "luis" })), "TV · seasons 1–2 · requested by luis");
  assert.equal(requestMeta(request(3, { mediaType: "tv", seasons: [] })), "TV · requested by maria");
});

test("outcomes name the library the request really went to", () => {
  assert.equal(outcomeText({ kind: "approved", library: "temp" }), "Approved → Temp library");
  assert.equal(outcomeText({ kind: "approved", library: "permanent" }), "Approved → Permanent library");
  assert.equal(outcomeText({ kind: "approved", library: "anime" }), "Approved → Anime library");
  assert.equal(outcomeText({ kind: "declined" }), "Declined");
  assert.equal(outcomeText({ kind: "elsewhere" }), "Already handled in Seerr");
});

test("decision failures: 409/404 settle the row, everything else keeps it active", () => {
  assert.deepEqual(decisionFailure(new ApiRequestError(409, "CONFLICT", "Seerr request 42 is no longer pending")), {
    settled: { kind: "elsewhere" },
  });
  assert.deepEqual(decisionFailure(new ApiRequestError(404, "NOT_FOUND", "Seerr request 42 was not found")), { settled: { kind: "gone" } });
  assert.deepEqual(decisionFailure(new ApiRequestError(502, "SEERR_UNAVAILABLE", "Seerr failed with status 503")), {
    retry: SEERR_RETRY_TEXT,
  });
  assert.deepEqual(decisionFailure(new ApiRequestError(502, "UPSTREAM_ERROR", "Seerr sent no keywords")), { retry: "Seerr sent no keywords" });
  assert.equal(requestErrorText(new ApiRequestError(0, "NETWORK_ERROR", "x")), "Can't reach the dashboard server — try again.");
  assert.equal(requestErrorText(new Error("boom")), "Something went wrong — try again.");
});

test("optimistic count only ever lowers to the target, so re-applying it is harmless", () => {
  const today = { warnings: { alerts: [], waiting: waiting({ seerrPending: 3 }) } } as unknown as TodayResponse;
  const once = withSeerrPendingAtMost(today, 2);
  assert.equal(once.warnings.waiting.seerrPending, 2);
  assert.equal(withSeerrPendingAtMost(once, 2), once);
  // The server already counted the approval (live refresh landed first): no double drop.
  const refreshed = { warnings: { alerts: [], waiting: waiting({ seerrPending: 2 }) } } as unknown as TodayResponse;
  assert.equal(withSeerrPendingAtMost(refreshed, 2).warnings.waiting.seerrPending, 2);
  // Seerr down: leave the "?" alone.
  const down = { warnings: { alerts: [], waiting: waiting({ seerrPending: null }) } } as unknown as TodayResponse;
  assert.equal(withSeerrPendingAtMost(down, 0).warnings.waiting.seerrPending, null);
});

test("reloading keeps handled rows in place, refreshes pending ones, puts new ones on top", () => {
  const a = request(1);
  const b = request(2);
  const c = request(3);
  const outcomes = { 2: { kind: "approved", library: "temp" } } as const;
  const merged = mergeRequestRows([a, b, c], [request(4), { ...a, title: "Renamed" }], outcomes);
  assert.deepEqual(
    merged.map((r) => [r.id, r.title]),
    [
      [4, "Title 4"],
      [1, "Renamed"],
      [2, "Title 2"],
    ],
  );
  assert.deepEqual(mergeRequestRows([], [a, b], {}), [a, b]);
});

test("list reducer: first load, failed reload keeps rows, handled rows survive the next load", () => {
  let state = seerrListReducer(initialSeerrList, { type: "loaded", requests: [request(1), request(2)] });
  assert.equal(state.phase, "ready");
  state = seerrListReducer(state, { type: "failed", message: SEERR_RETRY_TEXT });
  assert.equal(state.rows.length, 2);
  assert.equal(state.error, SEERR_RETRY_TEXT);
  state = seerrListReducer(state, { type: "handled", id: 1, outcome: { kind: "declined" } });
  state = seerrListReducer(state, { type: "loaded", requests: [request(2)] });
  assert.deepEqual(
    state.rows.map((r) => r.id),
    [1, 2],
  );
  assert.equal(state.error, null);
  assert.deepEqual(state.outcomes[1], { kind: "declined" });
});

test("'more in Seerr' only when the list hit its cap", () => {
  assert.equal(moreInSeerr(25, 20), 5);
  assert.equal(moreInSeerr(2, 2), null);
  assert.equal(moreInSeerr(3, 2), null); // a count that is briefly ahead of the list
  assert.equal(moreInSeerr(null, 20), null);
});

test("waiting items hide at zero; Seerr stays while down or open", () => {
  assert.deepEqual(waitingVisibility(waiting(), true, false), { gmail: false, seerr: false, orphans: false, nothing: true });
  assert.deepEqual(waitingVisibility(waiting({ gmailNeedsReply: 1 }), true, false), { gmail: true, seerr: false, orphans: false, nothing: false });
  assert.equal(waitingVisibility(waiting({ seerrPending: null }), false, false).seerr, true);
  assert.equal(waitingVisibility(waiting({ seerrPending: 0 }), true, true).seerr, true);
  assert.equal(waitingVisibility(waiting({ orphans: { sonarr: 0, radarr: 2, sonarrUrl: null, radarrUrl: null } }), true, false).orphans, true);
});

test("booked block tag: clock range today, with the day otherwise", () => {
  const now = new Date("2026-10-14T18:00:00Z"); // 12:00 MDT
  const today = { calendarEventId: "e", startsAt: "2026-10-15T01:00:00Z", endsAt: "2026-10-15T02:30:00Z" }; // 19:00–20:30 MDT
  assert.equal(blockTag(today, zone, now), "19:00–20:30");
  const tomorrow = { calendarEventId: "e", startsAt: "2026-10-15T15:00:00Z", endsAt: "2026-10-15T16:00:00Z" };
  assert.equal(blockTag(tomorrow, zone, now), "Oct 15 · 09:00–10:00");
});
