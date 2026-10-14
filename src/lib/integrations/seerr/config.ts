import { HttpError } from "@/lib/api/http";

export interface SeerrConfig {
  /** LAN base URL of Seerr without a trailing slash, e.g. http://192.168.1.10:5055. */
  baseUrl: string;
  /** Sent as X-Api-Key. Server-side only. */
  apiKey: string;
  /** Browser link for "Open Seerr ↗" (SEERR_PUBLIC_URL); null when not set. */
  publicUrl: string | null;
}

/** Where an approved request lands: a Radarr/Sonarr server in Seerr plus a root folder and quality profile. */
export interface SeerrLibraryTarget {
  serverId: number;
  rootFolder: string;
  profileId: number;
}

export interface SeerrMediaLibraries {
  temp: SeerrLibraryTarget;
  permanent: SeerrLibraryTarget;
  /** Anime always lands here, whatever Temp/Permanent says. */
  anime: SeerrLibraryTarget;
}

/** Temp | Permanent mapping (decision D14). */
export interface SeerrLibraryMapping {
  movie: SeerrMediaLibraries;
  tv: SeerrMediaLibraries;
}

function configError(message: string): HttpError {
  return new HttpError("SEERR_UNAVAILABLE", message);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (!value) throw configError(`${name} is not configured`);
  return value;
}

function httpUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configError(`${name} must be an http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw configError(`${name} must be an http(s) URL`);
  return value.replace(/\/+$/, "");
}

function integer(env: NodeJS.ProcessEnv, name: string, min: number): number {
  const raw = required(env, name);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min) {
    throw configError(`${name} must be an integer ≥ ${min}`);
  }
  return Number(raw);
}

function target(env: NodeJS.ProcessEnv, serverVar: string, rootVar: string, profileVar: string): SeerrLibraryTarget {
  return {
    // Seerr numbers its Radarr/Sonarr servers from 0.
    serverId: integer(env, serverVar, 0),
    rootFolder: required(env, rootVar),
    profileId: integer(env, profileVar, 1),
  };
}

/** Connection settings only; enough for listing requests and reading Seerr's server settings. */
export function loadSeerrConfig(env: NodeJS.ProcessEnv = process.env): SeerrConfig {
  const baseUrl = httpUrl("SEERR_URL", required(env, "SEERR_URL"));
  const apiKey = required(env, "SEERR_API_KEY");
  const publicRaw = env.SEERR_PUBLIC_URL?.trim() ?? "";
  return {
    baseUrl,
    apiKey,
    publicUrl: publicRaw ? httpUrl("SEERR_PUBLIC_URL", publicRaw) : null,
  };
}

/** The Temp | Permanent | anime library mapping. Needed to approve; every value comes from .env. */
export function loadSeerrLibraryMapping(env: NodeJS.ProcessEnv = process.env): SeerrLibraryMapping {
  return {
    movie: {
      temp: target(env, "SEERR_MOVIE_SERVER_ID", "SEERR_MOVIE_TEMP_ROOT", "SEERR_MOVIE_TEMP_PROFILE_ID"),
      permanent: target(env, "SEERR_MOVIE_SERVER_ID", "SEERR_MOVIE_PERMANENT_ROOT", "SEERR_MOVIE_PERMANENT_PROFILE_ID"),
      anime: target(env, "SEERR_MOVIE_SERVER_ID", "SEERR_ANIME_MOVIE_ROOT", "SEERR_ANIME_MOVIE_PROFILE_ID"),
    },
    tv: {
      temp: target(env, "SEERR_TV_SERVER_ID", "SEERR_TV_TEMP_ROOT", "SEERR_TV_TEMP_PROFILE_ID"),
      permanent: target(env, "SEERR_TV_SERVER_ID", "SEERR_TV_PERMANENT_ROOT", "SEERR_TV_PERMANENT_PROFILE_ID"),
      anime: target(env, "SEERR_TV_SERVER_ID", "SEERR_ANIME_TV_ROOT", "SEERR_ANIME_TV_PROFILE_ID"),
    },
  };
}
