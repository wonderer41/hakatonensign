import { HttpError } from "@/lib/api/http";
import { publishLiveEvent } from "@/lib/live/publish";
import { approveRequest, declineRequest, getMediaDetails, getRequest, updateRequest } from "./client";
import { loadSeerrConfig, loadSeerrLibraryMapping } from "./config";
import { chooseLibrary, isAnime, libraryUpdateBody, type ResolvedSeerrLibrary, type SeerrLibraryChoice } from "./mapping";
import { SEERR_STATUS_PENDING } from "./normalize";

/**
 * Moves a pending request into the Temp, Permanent or anime library (D14), then approves it.
 * If approving fails after the move, the request stays pending in the new library and can be retried.
 */
export async function approveSeerrRequest(
  requestId: number,
  choice: SeerrLibraryChoice,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedSeerrLibrary> {
  const config = loadSeerrConfig(env);
  const mapping = loadSeerrLibraryMapping(env);

  const request = await getRequest(config, requestId);
  if (request.status !== SEERR_STATUS_PENDING) {
    throw new HttpError("CONFLICT", `Seerr request ${requestId} is no longer pending`);
  }
  const details = await getMediaDetails(config, request.mediaType, request.tmdbId);
  if (details.keywordIds === null) {
    // Without keywords an anime title would silently land in Temp/Permanent.
    throw new HttpError("UPSTREAM_ERROR", `Seerr sent no keywords for ${request.mediaType} ${request.tmdbId}; can't tell if it is anime`);
  }

  const target = chooseLibrary(mapping, request.mediaType, isAnime(details.keywordIds), choice);
  await updateRequest(config, requestId, libraryUpdateBody(request, target));
  await approveRequest(config, requestId);
  await publishLiveEvent({ type: "seerr.changed" });
  return target;
}

export async function declineSeerrRequest(requestId: number, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await declineRequest(loadSeerrConfig(env), requestId);
  await publishLiveEvent({ type: "seerr.changed" });
}
