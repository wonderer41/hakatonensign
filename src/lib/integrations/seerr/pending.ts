import { publishLiveEvent } from "@/lib/live/publish";
import type { SeerrRequestDto } from "@/types/dashboard-contracts";
import { getMediaDetails, listRequests } from "./client";
import { loadSeerrConfig, type SeerrConfig } from "./config";
import { toSeerrRequestDto, type SeerrMediaDetails, type SeerrRequest } from "./normalize";

/** How many pending requests the panel lists (newest first, Seerr's default order). */
export const PENDING_TAKE = 20;
/** Parallel detail lookups against Seerr (each one may hit TMDB). */
const DETAILS_CONCURRENCY = 4;

export interface PendingEntry {
  request: SeerrRequest;
  /** Null when Seerr couldn't load the title details; the request is still listed. */
  details: SeerrMediaDetails | null;
}

export interface PendingEntries {
  /** All pending requests in Seerr, which can exceed entries.length. */
  total: number;
  entries: PendingEntry[];
}

async function mapLimited<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/** Pending requests plus their media details. Requests only carry a TMDB id, so details are fetched per title. */
export async function fetchPendingEntries(config: SeerrConfig = loadSeerrConfig()): Promise<PendingEntries> {
  const page = await listRequests(config, "pending", PENDING_TAKE);
  const titles = [...new Map(page.results.map((request) => [`${request.mediaType}:${request.tmdbId}`, request])).values()];

  const details = new Map<string, SeerrMediaDetails | null>();
  await mapLimited(titles, DETAILS_CONCURRENCY, async (request) => {
    const key = `${request.mediaType}:${request.tmdbId}`;
    try {
      details.set(key, await getMediaDetails(config, request.mediaType, request.tmdbId));
    } catch (error) {
      console.warn(`[seerr] details for ${key} unavailable:`, error instanceof Error ? error.message : error);
      details.set(key, null);
    }
  });

  return {
    total: page.total,
    entries: page.results.map((request) => ({ request, details: details.get(`${request.mediaType}:${request.tmdbId}`) ?? null })),
  };
}

/** What GET /api/seerr/requests returns. */
export async function fetchPendingRequests(env: NodeJS.ProcessEnv = process.env): Promise<SeerrRequestDto[]> {
  const { entries } = await fetchPendingEntries(loadSeerrConfig(env));
  return entries.map(({ request, details }) => toSeerrRequestDto(request, details));
}

/**
 * One tick of the 2-minute Seerr poll. The caller keeps `count` in memory and passes it back next time.
 * Publishes `seerr.changed` whenever the count differs from the last one, including the first poll
 * (null), so open pages catch up after a worker restart.
 */
export async function checkSeerrPending(
  lastKnownCount: number | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ count: number; changed: boolean }> {
  // Same filter as the list, so the Waiting count always matches the bubble.
  const { total } = await listRequests(loadSeerrConfig(env), "pending", 1);
  const changed = total !== lastKnownCount;
  if (changed) await publishLiveEvent({ type: "seerr.changed" });
  return { count: total, changed };
}
