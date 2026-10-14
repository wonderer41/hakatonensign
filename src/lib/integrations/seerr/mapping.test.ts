import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import { loadSeerrConfig, loadSeerrLibraryMapping } from "./config";
import { ANIME_KEYWORD_ID, chooseLibrary, isAnime, libraryUpdateBody } from "./mapping";
import { testEnv } from "./test-fixtures";

const mapping = loadSeerrLibraryMapping(testEnv());
const seerrUnavailable = (pattern: RegExp) => (error: unknown) =>
  error instanceof HttpError && error.code === "SEERR_UNAVAILABLE" && pattern.test(error.message);

test("anime is detected by Seerr's TMDB keyword id", () => {
  assert.equal(ANIME_KEYWORD_ID, 210024);
  assert.equal(isAnime([4565, 210024]), true);
  assert.equal(isAnime([4565]), false);
  assert.equal(isAnime([]), false);
});

test("movies follow the Temp | Permanent switch on the Radarr server", () => {
  assert.deepEqual(chooseLibrary(mapping, "movie", false, "temp"), { kind: "temp", serverId: 0, rootFolder: "/media/movies-temp", profileId: 4 });
  assert.deepEqual(chooseLibrary(mapping, "movie", false, "permanent"), { kind: "permanent", serverId: 0, rootFolder: "/media/movies", profileId: 3 });
});

test("shows follow the Temp | Permanent switch on the Sonarr server", () => {
  assert.deepEqual(chooseLibrary(mapping, "tv", false, "temp"), { kind: "temp", serverId: 1, rootFolder: "/media/tv-temp", profileId: 5 });
  assert.deepEqual(chooseLibrary(mapping, "tv", false, "permanent"), { kind: "permanent", serverId: 1, rootFolder: "/media/tv", profileId: 6 });
});

test("anime ignores the switch, for movies and shows", () => {
  for (const choice of ["temp", "permanent"] as const) {
    assert.deepEqual(chooseLibrary(mapping, "movie", true, choice), { kind: "anime", serverId: 0, rootFolder: "/media/anime-movies", profileId: 2 });
    assert.deepEqual(chooseLibrary(mapping, "tv", true, choice), { kind: "anime", serverId: 1, rootFolder: "/media/anime-tv", profileId: 2 });
  }
});

test("the update body carries seasons only for TV, and never is4k (Seerr ignores it)", () => {
  const target = { serverId: 0, rootFolder: "/media/movies-temp", profileId: 4 };
  assert.deepEqual(libraryUpdateBody({ id: 1, mediaType: "movie", seasons: [] }, target), {
    mediaType: "movie",
    serverId: 0,
    rootFolder: "/media/movies-temp",
    profileId: 4,
  });
  const tv = libraryUpdateBody({ id: 2, mediaType: "tv", seasons: [1, 3] }, target);
  assert.deepEqual(tv.seasons, [1, 3]);
  assert.equal("is4k" in tv, false);
  assert.throws(() => libraryUpdateBody({ id: 3, mediaType: "tv", seasons: [] }, target), HttpError);
});

test("config: every mapping value is required and ids must be integers", () => {
  assert.throws(() => loadSeerrLibraryMapping(testEnv({ SEERR_ANIME_TV_ROOT: "" })), seerrUnavailable(/SEERR_ANIME_TV_ROOT is not configured/));
  assert.throws(() => loadSeerrLibraryMapping(testEnv({ SEERR_TV_TEMP_PROFILE_ID: "abc" })), seerrUnavailable(/SEERR_TV_TEMP_PROFILE_ID/));
  assert.throws(() => loadSeerrLibraryMapping(testEnv({ SEERR_MOVIE_TEMP_PROFILE_ID: "0" })), seerrUnavailable(/SEERR_MOVIE_TEMP_PROFILE_ID/));
  assert.throws(() => loadSeerrLibraryMapping(testEnv({ SEERR_MOVIE_SERVER_ID: "-1" })), seerrUnavailable(/SEERR_MOVIE_SERVER_ID/));
});

test("config: connection needs URL and key; trailing slash is dropped", () => {
  const config = loadSeerrConfig(testEnv());
  assert.equal(config.baseUrl, "http://seerr.test:5055");
  assert.equal(config.publicUrl, "https://requests.example.com");
  assert.equal(loadSeerrConfig(testEnv({ SEERR_PUBLIC_URL: "" })).publicUrl, null);
  assert.throws(() => loadSeerrConfig(testEnv({ SEERR_API_KEY: " " })), seerrUnavailable(/SEERR_API_KEY is not configured/));
  assert.throws(() => loadSeerrConfig(testEnv({ SEERR_URL: "seerr:5055" })), seerrUnavailable(/SEERR_URL/));
});
