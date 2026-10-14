// Seerr API payloads shaped like the real responses (MediaRequest with eager media/seasons/requestedBy,
// MovieDetails/TvDetails from server/models). Only used by the *.test.ts files next to this one.

export const movieRequest = {
  id: 42,
  status: 1,
  createdAt: "2026-10-13T02:14:05.000Z",
  updatedAt: "2026-10-13T02:14:05.000Z",
  type: "movie",
  is4k: false,
  serverId: null,
  profileId: null,
  rootFolder: null,
  languageProfileId: null,
  tags: null,
  isAutoRequest: false,
  media: { id: 7, mediaType: "movie", tmdbId: 603, tvdbId: null, imdbId: null, status: 2, status4k: 1 },
  seasons: [],
  modifiedBy: null,
  requestedBy: {
    id: 3,
    email: "guest@example.com",
    username: null,
    plexUsername: null,
    jellyfinUsername: "maria",
    userType: 3,
    permissions: 32,
    avatar: "/avatarproxy/abc",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    requestCount: 2,
    displayName: "maria",
  },
  seasonCount: 0,
  canRemove: true,
};

export const tvRequest = {
  id: 43,
  status: 1,
  createdAt: "2026-10-13T03:00:00.000Z",
  updatedAt: "2026-10-13T03:00:00.000Z",
  type: "tv",
  is4k: false,
  serverId: 0,
  profileId: 6,
  rootFolder: "/data/tvshows",
  languageProfileId: null,
  tags: [],
  isAutoRequest: false,
  media: { id: 9, mediaType: "tv", tmdbId: 1429, tvdbId: 267440, status: 2, status4k: 1 },
  seasons: [
    { id: 11, seasonNumber: 2, status: 1, createdAt: "2026-10-13T03:00:00.000Z", updatedAt: "2026-10-13T03:00:00.000Z" },
    { id: 10, seasonNumber: 1, status: 1, createdAt: "2026-10-13T03:00:00.000Z", updatedAt: "2026-10-13T03:00:00.000Z" },
  ],
  modifiedBy: null,
  requestedBy: { id: 4, email: "luis@example.com", username: "luis", plexUsername: null, jellyfinUsername: null, displayName: "luis" },
  seasonCount: 2,
  canRemove: true,
};

export const pendingPage = {
  pageInfo: { pages: 1, pageSize: 20, results: 2, page: 1 },
  results: [tvRequest, movieRequest],
  serviceErrors: { radarr: [], sonarr: [] },
};

export const movieDetails = {
  id: 603,
  imdbId: "tt0133093",
  title: "The Matrix",
  originalTitle: "The Matrix",
  releaseDate: "1999-03-31",
  overview: "…",
  keywords: [
    { id: 310, name: "artificial intelligence (a.i.)" },
    { id: 4565, name: "dystopia" },
  ],
  mediaInfo: { id: 7, tmdbId: 603, status: 2 },
};

export const animeMovieDetails = {
  ...movieDetails,
  id: 129,
  title: "Spirited Away",
  originalTitle: "千と千尋の神隠し",
  releaseDate: "2001-07-20",
  keywords: [
    { id: 210024, name: "anime" },
    { id: 3205, name: "fairy tale" },
  ],
};

export const animeTvDetails = {
  id: 1429,
  name: "Attack on Titan",
  originalName: "進撃の巨人",
  firstAirDate: "2013-04-07",
  keywords: [
    { id: 210024, name: "anime" },
    { id: 12554, name: "dark fantasy" },
  ],
  mediaInfo: { id: 9, tmdbId: 1429, status: 2 },
};

export const plainTvDetails = { ...animeTvDetails, name: "Severance", keywords: [{ id: 12345, name: "office" }] };

/** Illustrative mapping for tests (not anyone's real paths or ids). */
export const TEST_ENV_VARS: Record<string, string> = {
  SEERR_URL: "http://seerr.test:5055/",
  SEERR_API_KEY: "test-api-key",
  SEERR_PUBLIC_URL: "https://requests.example.com",
  SEERR_MOVIE_SERVER_ID: "0",
  SEERR_MOVIE_TEMP_ROOT: "/media/movies-temp",
  SEERR_MOVIE_TEMP_PROFILE_ID: "4",
  SEERR_MOVIE_PERMANENT_ROOT: "/media/movies",
  SEERR_MOVIE_PERMANENT_PROFILE_ID: "3",
  SEERR_TV_SERVER_ID: "1",
  SEERR_TV_TEMP_ROOT: "/media/tv-temp",
  SEERR_TV_TEMP_PROFILE_ID: "5",
  SEERR_TV_PERMANENT_ROOT: "/media/tv",
  SEERR_TV_PERMANENT_PROFILE_ID: "6",
  SEERR_ANIME_MOVIE_ROOT: "/media/anime-movies",
  SEERR_ANIME_MOVIE_PROFILE_ID: "2",
  SEERR_ANIME_TV_ROOT: "/media/anime-tv",
  SEERR_ANIME_TV_PROFILE_ID: "2",
};

export function testEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...TEST_ENV_VARS, ...overrides } as unknown as NodeJS.ProcessEnv;
}
