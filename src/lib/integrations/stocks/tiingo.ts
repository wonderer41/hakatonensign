import { HttpError } from "@/lib/api/http";
import type { StocksApiConfig } from "./config";

const TIINGO_URL = "https://api.tiingo.com/tiingo/daily";
const REQUEST_TIMEOUT_MS = 10_000;

export interface DailyPrice {
  /** Trading day, YYYY-MM-DD. */
  date: string;
  adjClose: number;
}

type FetchLike = typeof fetch;

/** Parses Tiingo's daily price array into ascending { date, adjClose } points. */
export function parseTiingoPrices(symbol: string, body: unknown): DailyPrice[] {
  if (!Array.isArray(body)) throw new HttpError("UPSTREAM_ERROR", `Tiingo returned an unexpected body for ${symbol}`);
  const prices: DailyPrice[] = [];
  for (const item of body as { date?: unknown; adjClose?: unknown }[]) {
    if (typeof item?.date !== "string" || typeof item.adjClose !== "number") continue;
    prices.push({ date: item.date.slice(0, 10), adjClose: item.adjClose });
  }
  return prices.sort((a, b) => a.date.localeCompare(b.date));
}

/** Daily adjusted closes from `startDate` (YYYY-MM-DD) through the latest trading day. */
export async function fetchTiingoPrices(
  symbol: string,
  startDate: string,
  config: StocksApiConfig,
  fetchImpl: FetchLike = fetch,
): Promise<DailyPrice[]> {
  const url = new URL(`${TIINGO_URL}/${encodeURIComponent(symbol)}/prices`);
  url.searchParams.set("startDate", startDate);
  let response: Response;
  try {
    // The key goes in a header so it never ends up in a logged URL.
    response = await fetchImpl(url, {
      headers: { Authorization: `Token ${config.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "request failed";
    throw new HttpError("UPSTREAM_ERROR", `Tiingo request for ${symbol} failed (${reason})`);
  }
  if (!response.ok) {
    throw new HttpError("UPSTREAM_ERROR", `Tiingo returned HTTP ${response.status} for ${symbol}`);
  }
  return parseTiingoPrices(symbol, await response.json());
}
