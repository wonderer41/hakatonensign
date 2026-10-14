import { HttpError } from "@/lib/api/http";
import type { SeerrConfig } from "./config";
import {
  parseSeerrMediaDetails,
  parseSeerrRequest,
  parseSeerrRequestPage,
  type SeerrMediaDetails,
  type SeerrMediaType,
  type SeerrRequest,
  type SeerrRequestPage,
} from "./normalize";

// Endpoints and shapes checked against seerr-team/seerr (seerr-api.yml and server/routes/*.ts).
const API_PREFIX = "/api/v1";
const TIMEOUT_MS = 10_000;

/**
 * Body of PUT /api/v1/request/{id}. Seerr requires seasons for TV and only edits pending requests.
 * is4k is not sent: Seerr ignores it on this endpoint and keeps the one the request was created with.
 */
export interface SeerrUpdateRequestBody {
  mediaType: SeerrMediaType;
  serverId: number;
  rootFolder: string;
  profileId: number;
  seasons?: number[];
}

interface CallOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  /** Message for a 404; without it a 404 is an upstream error. */
  notFound?: string;
  /** Message for a 409; without it a 409 is an upstream error. */
  conflict?: string;
}

interface CallResult {
  status: number;
  payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function call(config: SeerrConfig, path: string, options: CallOptions = {}): Promise<CallResult> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Api-Key": config.apiKey };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${API_PREFIX}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new HttpError("SEERR_UNAVAILABLE", timedOut ? `Seerr did not answer within ${TIMEOUT_MS / 1000} s` : "Seerr could not be reached");
  }

  if (!response.ok) {
    // Drain the body so the connection can be reused; Seerr's error text is not passed on.
    await response.text().catch(() => "");
    if (response.status === 404 && options.notFound) throw new HttpError("NOT_FOUND", options.notFound);
    if (response.status === 409 && options.conflict) throw new HttpError("CONFLICT", options.conflict);
    if (response.status === 401 || response.status === 403) {
      throw new HttpError("SEERR_UNAVAILABLE", `Seerr rejected the API key (status ${response.status})`);
    }
    if (response.status >= 500) throw new HttpError("SEERR_UNAVAILABLE", `Seerr failed with status ${response.status}`);
    throw new HttpError("UPSTREAM_ERROR", `Seerr returned status ${response.status}`);
  }

  const raw = await response.text().catch(() => {
    throw new HttpError("SEERR_UNAVAILABLE", "Seerr closed the connection mid-response");
  });
  if (!raw) return { status: response.status, payload: null };
  try {
    return { status: response.status, payload: JSON.parse(raw) as unknown };
  } catch {
    throw new HttpError("UPSTREAM_ERROR", "Seerr returned invalid JSON");
  }
}

// ---------- Requests ----------

export type SeerrRequestFilter = "pending" | "approved" | "all";

export async function listRequests(config: SeerrConfig, filter: SeerrRequestFilter, take: number): Promise<SeerrRequestPage> {
  const params = new URLSearchParams({ filter, take: String(take), skip: "0" });
  const { payload } = await call(config, `/request?${params.toString()}`);
  return parseSeerrRequestPage(payload);
}

export async function getRequest(config: SeerrConfig, requestId: number): Promise<SeerrRequest> {
  const { payload } = await call(config, `/request/${requestId}`, { notFound: `Seerr request ${requestId} was not found` });
  return parseSeerrRequest(payload);
}

export async function getMediaDetails(config: SeerrConfig, mediaType: SeerrMediaType, tmdbId: number): Promise<SeerrMediaDetails> {
  const { payload } = await call(config, `/${mediaType}/${tmdbId}`);
  return parseSeerrMediaDetails(payload, mediaType, tmdbId);
}

/** Moves a pending request to another server / root folder / quality profile before it is approved. */
export async function updateRequest(config: SeerrConfig, requestId: number, body: SeerrUpdateRequestBody): Promise<void> {
  const { status } = await call(config, `/request/${requestId}`, {
    method: "PUT",
    body,
    notFound: `Seerr request ${requestId} was not found`,
    conflict: `Seerr request ${requestId} is no longer pending`,
  });
  // Seerr answers 202 (and saves nothing) when every requested season is already requested or available.
  if (status !== 200) throw new HttpError("CONFLICT", `Seerr did not update request ${requestId}: no seasons left to request`);
}

async function setRequestStatus(config: SeerrConfig, requestId: number, decision: "approve" | "decline"): Promise<void> {
  await call(config, `/request/${requestId}/${decision}`, {
    method: "POST",
    notFound: `Seerr request ${requestId} was not found`,
    conflict: `Seerr request ${requestId} is no longer pending`,
  });
}

export function approveRequest(config: SeerrConfig, requestId: number): Promise<void> {
  return setRequestStatus(config, requestId, "approve");
}

export function declineRequest(config: SeerrConfig, requestId: number): Promise<void> {
  return setRequestStatus(config, requestId, "decline");
}

// ---------- Radarr / Sonarr settings (read-only, for the setup scripts) ----------

export type SeerrArrKind = "radarr" | "sonarr";

/** A Radarr/Sonarr server as Seerr knows it. Only these fields are kept; Seerr's settings also carry the *arr API key. */
export interface SeerrArrServer {
  id: number;
  name: string;
  is4k: boolean;
  isDefault: boolean;
  activeDirectory: string | null;
  activeProfileId: number | null;
  activeProfileName: string | null;
  /** Sonarr only. */
  activeAnimeDirectory: string | null;
  activeAnimeProfileId: number | null;
  activeAnimeProfileName: string | null;
}

export interface SeerrArrOptions {
  profiles: { id: number; name: string }[];
  rootFolders: { path: string; freeSpace: number | null }[];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function parseArrServer(value: unknown): SeerrArrServer {
  if (!isRecord(value)) throw new HttpError("UPSTREAM_ERROR", "Seerr returned a malformed server entry");
  const id = integerOrNull(value.id);
  if (id === null) throw new HttpError("UPSTREAM_ERROR", "Seerr returned a server without an id");
  return {
    id,
    name: stringOrNull(value.name) ?? `Server ${id}`,
    is4k: value.is4k === true,
    isDefault: value.isDefault === true,
    activeDirectory: stringOrNull(value.activeDirectory),
    activeProfileId: integerOrNull(value.activeProfileId),
    activeProfileName: stringOrNull(value.activeProfileName),
    activeAnimeDirectory: stringOrNull(value.activeAnimeDirectory),
    activeAnimeProfileId: integerOrNull(value.activeAnimeProfileId),
    activeAnimeProfileName: stringOrNull(value.activeAnimeProfileName),
  };
}

/** GET /settings/radarr or /settings/sonarr (admin). */
export async function getArrServers(config: SeerrConfig, kind: SeerrArrKind): Promise<SeerrArrServer[]> {
  const { payload } = await call(config, `/settings/${kind}`);
  if (!Array.isArray(payload)) throw new HttpError("UPSTREAM_ERROR", `Seerr returned malformed ${kind} settings`);
  return payload.map(parseArrServer);
}

/** GET /service/radarr/{id} or /service/sonarr/{id}: the quality profiles and root folders Seerr can pick from. */
export async function getArrOptions(config: SeerrConfig, kind: SeerrArrKind, serverId: number): Promise<SeerrArrOptions> {
  const { payload } = await call(config, `/service/${kind}/${serverId}`, { notFound: `Seerr has no ${kind} server ${serverId}` });
  if (!isRecord(payload)) throw new HttpError("UPSTREAM_ERROR", `Seerr returned malformed ${kind} options`);
  const profiles = (Array.isArray(payload.profiles) ? payload.profiles : [])
    .filter(isRecord)
    .map((profile) => ({ id: integerOrNull(profile.id), name: stringOrNull(profile.name) ?? "(unnamed)" }))
    .filter((profile): profile is { id: number; name: string } => profile.id !== null);
  const rootFolders = (Array.isArray(payload.rootFolders) ? payload.rootFolders : [])
    .filter(isRecord)
    .map((folder) => ({ path: stringOrNull(folder.path), freeSpace: integerOrNull(folder.freeSpace) }))
    .filter((folder): folder is { path: string; freeSpace: number | null } => folder.path !== null);
  return { profiles, rootFolders };
}
