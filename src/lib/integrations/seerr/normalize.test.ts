import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import { parseSeerrMediaDetails, parseSeerrRequest, parseSeerrRequestPage, toSeerrRequestDto } from "./normalize";
import { animeTvDetails, movieDetails, movieRequest, pendingPage, tvRequest } from "./test-fixtures";

const isUpstream = (error: unknown) => error instanceof HttpError && error.code === "UPSTREAM_ERROR";

test("a pending page keeps Seerr's order and total", () => {
  const page = parseSeerrRequestPage(pendingPage);
  assert.equal(page.total, 2);
  assert.deepEqual(page.results.map((request) => request.id), [43, 42]);
  assert.equal(parseSeerrRequestPage({ results: [movieRequest] }).total, 1);
});

test("requests carry type, TMDB id, sorted seasons and the requester's display name", () => {
  const tv = parseSeerrRequest(tvRequest);
  assert.equal(tv.mediaType, "tv");
  assert.equal(tv.tmdbId, 1429);
  assert.equal(tv.status, 1);
  assert.deepEqual(tv.seasons, [1, 2]);
  assert.equal(tv.requestedBy, "luis");

  const movie = parseSeerrRequest(movieRequest);
  assert.deepEqual(movie.seasons, []);
  assert.equal(movie.requestedBy, "maria");
  assert.equal(movie.createdAt, "2026-10-13T02:14:05.000Z");
});

test("without displayName the requester falls back to the usernames, never the raw email field", () => {
  const noDisplayName = { ...movieRequest, requestedBy: { ...movieRequest.requestedBy, displayName: undefined } };
  assert.equal(parseSeerrRequest(noDisplayName).requestedBy, "maria");
  const nobody = { ...movieRequest, requestedBy: { id: 9, email: "x@example.com" } };
  assert.equal(parseSeerrRequest(nobody).requestedBy, "Unknown user");
});

test("malformed requests are rejected as upstream errors", () => {
  assert.throws(() => parseSeerrRequest({ ...movieRequest, media: null }), isUpstream);
  assert.throws(() => parseSeerrRequest({ ...movieRequest, type: "music", media: { tmdbId: 1 } }), isUpstream);
  assert.throws(() => parseSeerrRequest({ ...movieRequest, createdAt: "yesterday" }), isUpstream);
  assert.throws(() => parseSeerrRequestPage({ results: "nope" }), isUpstream);
});

test("movie details → DTO with title and year", () => {
  const dto = toSeerrRequestDto(parseSeerrRequest(movieRequest), parseSeerrMediaDetails(movieDetails, "movie", 603));
  assert.deepEqual(dto, {
    id: 42,
    title: "The Matrix",
    year: 1999,
    mediaType: "movie",
    seasons: null,
    requestedBy: "maria",
    createdAt: "2026-10-13T02:14:05.000Z",
  });
});

test("TV details use name/firstAirDate and keep keyword ids", () => {
  const details = parseSeerrMediaDetails(animeTvDetails, "tv", 1429);
  assert.equal(details.title, "Attack on Titan");
  assert.equal(details.year, 2013);
  assert.deepEqual(details.keywordIds, [210024, 12554]);
  const dto = toSeerrRequestDto(parseSeerrRequest(tvRequest), details);
  assert.deepEqual(dto.seasons, [1, 2]);
  assert.equal(dto.mediaType, "tv");
});

test("missing details still list the request; a missing release date or keyword list is not guessed", () => {
  const dto = toSeerrRequestDto(parseSeerrRequest(movieRequest), null);
  assert.equal(dto.title, "TMDB #603");
  assert.equal(dto.year, null);
  assert.equal("posterUrl" in dto, false);

  const odd = parseSeerrMediaDetails({ ...movieDetails, releaseDate: "", keywords: undefined }, "movie", 603);
  assert.equal(odd.year, null);
  assert.equal(odd.keywordIds, null);
  assert.throws(() => parseSeerrMediaDetails({ ...movieDetails, title: "", originalTitle: "" }, "movie", 603), isUpstream);
});
