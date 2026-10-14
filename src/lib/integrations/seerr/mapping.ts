import { HttpError } from "@/lib/api/http";
import type { SeerrDecisionRequest } from "@/types/dashboard-contracts";
import type { SeerrUpdateRequestBody } from "./client";
import type { SeerrLibraryMapping, SeerrLibraryTarget } from "./config";
import type { SeerrMediaType, SeerrRequest } from "./normalize";

/**
 * TMDB keyword "anime". Seerr uses the same id to route anime to Sonarr's anime folder/profile
 * (seerr-team/seerr: server/api/themoviedb/constants.ts ANIME_KEYWORD_ID, used in
 * server/subscriber/MediaRequestSubscriber.ts and server/lib/overrideRules.ts).
 */
export const ANIME_KEYWORD_ID = 210024;

export type SeerrLibraryChoice = SeerrDecisionRequest["library"];
export type SeerrLibraryKind = SeerrLibraryChoice | "anime";

export interface ResolvedSeerrLibrary extends SeerrLibraryTarget {
  kind: SeerrLibraryKind;
}

export function isAnime(keywordIds: readonly number[]): boolean {
  return keywordIds.includes(ANIME_KEYWORD_ID);
}

/** Anime always goes to the anime library; everything else follows the Temp | Permanent switch. */
export function chooseLibrary(
  mapping: SeerrLibraryMapping,
  mediaType: SeerrMediaType,
  anime: boolean,
  choice: SeerrLibraryChoice,
): ResolvedSeerrLibrary {
  const libraries = mapping[mediaType];
  const kind: SeerrLibraryKind = anime ? "anime" : choice;
  return { kind, ...libraries[kind] };
}

/** The PUT /request/{id} body that moves a pending request into the chosen library. */
export function libraryUpdateBody(
  request: Pick<SeerrRequest, "id" | "mediaType" | "seasons">,
  target: SeerrLibraryTarget,
): SeerrUpdateRequestBody {
  const body: SeerrUpdateRequestBody = {
    mediaType: request.mediaType,
    serverId: target.serverId,
    rootFolder: target.rootFolder,
    profileId: target.profileId,
  };
  if (request.mediaType === "tv") {
    // Seerr rejects a TV edit without seasons; resend the ones already on the request.
    if (request.seasons.length === 0) throw new HttpError("UPSTREAM_ERROR", `Seerr request ${request.id} has no seasons`);
    body.seasons = [...request.seasons];
  }
  return body;
}
