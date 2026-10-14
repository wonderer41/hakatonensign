import { HttpError } from "@/lib/api/http";
import type { SeerrRequestDto } from "@/types/dashboard-contracts";

export type SeerrMediaType = SeerrRequestDto["mediaType"];

/** MediaRequestStatus in Seerr (server/constants/media.ts): 1 pending, 2 approved, 3 declined, 4 failed, 5 completed. */
export const SEERR_STATUS_PENDING = 1;

/** The parts of a Seerr MediaRequest the dashboard uses. */
export interface SeerrRequest {
  id: number;
  status: number;
  mediaType: SeerrMediaType;
  tmdbId: number;
  is4k: boolean;
  /** Requested season numbers (TV only), ascending. */
  seasons: number[];
  /** Seerr's displayName for the requester. */
  requestedBy: string;
  createdAt: string;
}

export interface SeerrRequestPage {
  /** Total matching requests in Seerr (pageInfo.results), not just this page. */
  total: number;
  results: SeerrRequest[];
}

/** From Seerr's /movie/{tmdbId} or /tv/{tmdbId}. */
export interface SeerrMediaDetails {
  tmdbId: number;
  mediaType: SeerrMediaType;
  title: string;
  year: number | null;
  /** TMDB keyword ids; null when Seerr sent no keyword list (anime can't be told apart then). */
  keywordIds: number[] | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function malformed(what: string): HttpError {
  return new HttpError("UPSTREAM_ERROR", `Seerr returned a malformed ${what}`);
}

function mediaTypeOf(value: unknown): SeerrMediaType | null {
  return value === "movie" || value === "tv" ? value : null;
}

function displayName(user: unknown): string {
  if (!isRecord(user)) return "Unknown user";
  // Seerr's own fallback chain (User.setDisplayName); displayName is already set on loaded users.
  return (
    text(user.displayName) ??
    text(user.username) ??
    text(user.plexUsername) ??
    text(user.jellyfinUsername) ??
    "Unknown user"
  );
}

function seasonNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const numbers = value
    .map((season) => (isRecord(season) ? nonNegativeInteger(season.seasonNumber) : null))
    .filter((season): season is number => season !== null);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

export function parseSeerrRequest(value: unknown): SeerrRequest {
  if (!isRecord(value)) throw malformed("request");
  const id = nonNegativeInteger(value.id);
  const status = nonNegativeInteger(value.status);
  const media = isRecord(value.media) ? value.media : null;
  const mediaType = mediaTypeOf(value.type) ?? mediaTypeOf(media?.mediaType);
  const tmdbId = nonNegativeInteger(media?.tmdbId);
  const createdAt = typeof value.createdAt === "string" ? new Date(value.createdAt) : null;
  if (id === null || id === 0 || status === null || !mediaType || tmdbId === null || !createdAt || Number.isNaN(createdAt.getTime())) {
    throw malformed("request");
  }
  return {
    id,
    status,
    mediaType,
    tmdbId,
    is4k: value.is4k === true,
    seasons: mediaType === "tv" ? seasonNumbers(value.seasons) : [],
    requestedBy: displayName(value.requestedBy),
    createdAt: createdAt.toISOString(),
  };
}

export function parseSeerrRequestPage(value: unknown): SeerrRequestPage {
  if (!isRecord(value) || !Array.isArray(value.results)) throw malformed("request list");
  const results = value.results.map(parseSeerrRequest);
  const total = isRecord(value.pageInfo) ? nonNegativeInteger(value.pageInfo.results) : null;
  return { total: total ?? results.length, results };
}

function yearOf(date: unknown): number | null {
  const match = typeof date === "string" ? /^(\d{4})-\d{2}-\d{2}/.exec(date) : null;
  return match ? Number(match[1]) : null;
}

function keywordIdsOf(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((keyword) => (isRecord(keyword) ? nonNegativeInteger(keyword.id) : null))
    .filter((id): id is number => id !== null);
}

/** Parses Seerr's movie details (title/releaseDate) or TV details (name/firstAirDate). */
export function parseSeerrMediaDetails(value: unknown, mediaType: SeerrMediaType, tmdbId: number): SeerrMediaDetails {
  if (!isRecord(value)) throw malformed(`${mediaType} details`);
  const title = mediaType === "movie" ? text(value.title) ?? text(value.originalTitle) : text(value.name) ?? text(value.originalName);
  if (!title) throw malformed(`${mediaType} details`);
  return {
    tmdbId,
    mediaType,
    title,
    year: yearOf(mediaType === "movie" ? value.releaseDate : value.firstAirDate),
    keywordIds: keywordIdsOf(value.keywords),
  };
}

/** Request + its media details → what the Waiting panel shows. Details may be null when Seerr couldn't load them. */
export function toSeerrRequestDto(request: SeerrRequest, details: SeerrMediaDetails | null): SeerrRequestDto {
  return {
    id: request.id,
    title: details?.title ?? `TMDB #${request.tmdbId}`,
    year: details?.year ?? null,
    mediaType: request.mediaType,
    seasons: request.mediaType === "tv" ? request.seasons : null,
    requestedBy: request.requestedBy,
    createdAt: request.createdAt,
  };
}
