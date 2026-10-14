import { HttpError } from "@/lib/api/http";
import type { StocksApiConfig } from "./config";

const FINNHUB_QUOTE_URL = "https://finnhub.io/api/v1/quote";
const REQUEST_TIMEOUT_MS = 10_000;

export interface FinnhubQuote {
  price: number;
  dayChangePct: number;
}

type FetchLike = typeof fetch;

/** Parses a Finnhub /quote body: `c` is the current price, `dp` the day change in percent. */
export function parseFinnhubQuote(symbol: string, body: unknown): FinnhubQuote {
  const data = (body ?? {}) as { c?: unknown; dp?: unknown; t?: unknown };
  // Finnhub answers an unknown symbol with 200 and all zeros (t = 0), not with an error.
  if (typeof data.c !== "number" || data.c <= 0 || data.t === 0) {
    throw new HttpError("UPSTREAM_ERROR", `Finnhub returned no quote for ${symbol}`);
  }
  if (typeof data.dp !== "number") {
    throw new HttpError("UPSTREAM_ERROR", `Finnhub returned no day change for ${symbol}`);
  }
  return { price: data.c, dayChangePct: data.dp };
}

export async function fetchFinnhubQuote(
  symbol: string,
  config: StocksApiConfig,
  fetchImpl: FetchLike = fetch,
): Promise<FinnhubQuote> {
  const url = new URL(FINNHUB_QUOTE_URL);
  url.searchParams.set("symbol", symbol);
  let response: Response;
  try {
    // The key goes in a header so it never ends up in a logged URL.
    response = await fetchImpl(url, {
      headers: { "X-Finnhub-Token": config.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "request failed";
    throw new HttpError("UPSTREAM_ERROR", `Finnhub request for ${symbol} failed (${reason})`);
  }
  if (!response.ok) {
    throw new HttpError("UPSTREAM_ERROR", `Finnhub returned HTTP ${response.status} for ${symbol}`);
  }
  return parseFinnhubQuote(symbol, await response.json());
}
