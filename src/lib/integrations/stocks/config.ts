import { HttpError } from "@/lib/api/http";

export interface StocksApiConfig {
  apiKey: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (!value) throw new HttpError("UPSTREAM_ERROR", `${name} is not configured`);
  return value;
}

/** Quote sync (every 5 min). */
export function loadFinnhubConfig(env: NodeJS.ProcessEnv = process.env): StocksApiConfig {
  return { apiKey: required(env, "FINNHUB_API_KEY") };
}

/** Daily history sync, and the inline fetch for a symbol with no cached 6M value. */
export function loadTiingoConfig(env: NodeJS.ProcessEnv = process.env): StocksApiConfig {
  return { apiKey: required(env, "TIINGO_API_KEY") };
}
