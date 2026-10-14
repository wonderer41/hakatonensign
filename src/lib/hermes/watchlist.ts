import { syncStockQuotes } from "@/lib/integrations/stocks/sync";
import { readWatchlist, replaceWatchlist } from "@/lib/integrations/stocks/watchlist";
import { safeErrorMessage, safeLogText } from "@/lib/live/redact";
import type { HermesWatchlist, HermesWatchlistResult } from "@/types/dashboard-contracts";

// D9: the watchlist lives in WatchlistSymbol and Hermes may replace it any time. Quotes come
// from Finnhub/Tiingo on the server, so after a change the banner is refreshed right away
// instead of waiting for the next 5-minute quote job.

export async function getWatchlist(): Promise<HermesWatchlist> {
  return { symbols: (await readWatchlist()).map((entry) => entry.symbol) };
}

/** PUT /api/hermes/watchlist. `symbols` is already validated and de-duplicated. */
export async function setWatchlist(
  symbols: string[],
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<HermesWatchlistResult> {
  const saved = await replaceWatchlist(symbols, "hermes");
  const base = { data: { symbols: saved.symbols }, created: false, changed: saved.changed };
  if (!saved.changed) return { ...base, synced: false };

  if (!env.FINNHUB_API_KEY?.trim()) {
    return { ...base, synced: false, syncError: "FINNHUB_API_KEY is not set on the dashboard; the banner updates once stock quotes are configured" };
  }
  try {
    // Publishes banner.updated itself.
    const { failed } = await syncStockQuotes(now);
    if (failed.length === 0) return { ...base, synced: true };
    const detail = failed.map((entry) => `${entry.symbol} (${entry.message})`).join("; ");
    return { ...base, synced: true, syncError: safeLogText(`No quote for ${detail}`, env) };
  } catch (error) {
    return { ...base, synced: false, syncError: safeErrorMessage(error, env) };
  }
}
