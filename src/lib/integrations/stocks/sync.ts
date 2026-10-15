import type { StocksSnapshot } from "@/types/dashboard-contracts";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import { publishLiveEvent } from "@/lib/live/publish";
import { dashboardTimeZone, localDateString } from "@/lib/time/zone";
import { buildRow, buildSnapshot, sixMonthChangePct, sixMonthsBefore, type StockRow } from "./compute";
import { loadFinnhubConfig, loadTiingoConfig, type StocksApiConfig } from "./config";
import { fetchFinnhubQuote } from "./finnhub";
import { fetchTiingoPrices } from "./tiingo";
import { emptyWatchlistError, readWatchlist } from "./watchlist";

// Tiingo's history job skips a symbol refreshed more recently than this unless forced.
const HISTORY_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export interface StockSyncFailure {
  symbol: string;
  message: string;
}

export interface QuoteSyncResult {
  snapshot: StocksSnapshot;
  failed: StockSyncFailure[];
}

export interface HistorySyncResult {
  updated: string[];
  skipped: string[];
  failed: StockSyncFailure[];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/** True when Tiingo was asked about this symbol less than HISTORY_MAX_AGE_MS ago (success or not). */
function recentlyAsked(asOf: Date | null, now: Date): boolean {
  return asOf !== null && now.getTime() - asOf.getTime() < HISTORY_MAX_AGE_MS;
}

/** Fetches Tiingo history for one symbol, computes the 6M change and caches it on the watchlist row. */
async function refreshSixMonth(symbol: string, now: Date, config: StocksApiConfig): Promise<number> {
  const today = localDateString(now, dashboardTimeZone());
  const prices = await fetchTiingoPrices(symbol, sixMonthsBefore(today), config);
  const pct = sixMonthChangePct(prices, today);
  if (pct === null) throw new HttpError("UPSTREAM_ERROR", `Tiingo has no usable 6-month history for ${symbol}`);
  await prisma.watchlistSymbol.update({
    where: { symbol },
    data: { sixMonthChangePct: pct, sixMonthAsOf: now },
  });
  return pct;
}

/** Every 5 minutes: quotes for the whole watchlist -> one complete BannerSnapshot (kind stocks). */
export async function syncStockQuotes(now: Date): Promise<QuoteSyncResult> {
  const watchlist = await readWatchlist();
  if (watchlist.length === 0) throw emptyWatchlistError();
  const finnhub = loadFinnhubConfig();

  let tiingo: StocksApiConfig | null = null;
  const rows: StockRow[] = [];
  const failed: StockSyncFailure[] = [];

  // Sequential on purpose: Finnhub allows 60 calls/min and the list is short.
  for (const entry of watchlist) {
    try {
      const quote = await fetchFinnhubQuote(entry.symbol, finnhub);
      let sixMonth = entry.sixMonthChangePct;
      if (sixMonth === null && !recentlyAsked(entry.sixMonthAsOf, now)) {
        // New symbol: fetch history now so the snapshot is complete. If Tiingo has none, keep the
        // quote (6M shows "—") and remember the attempt so the next try waits for the daily job.
        tiingo ??= loadTiingoConfig();
        try {
          sixMonth = await refreshSixMonth(entry.symbol, now, tiingo);
        } catch (error) {
          await prisma.watchlistSymbol.update({ where: { symbol: entry.symbol }, data: { sixMonthAsOf: now } });
          console.warn(`[stocks] ${entry.symbol}: no 6-month history yet (${describe(error)})`);
        }
      }
      rows.push(buildRow(entry.symbol, quote, sixMonth));
    } catch (error) {
      const message = describe(error);
      failed.push({ symbol: entry.symbol, message });
      console.warn(`[stocks] ${entry.symbol}: ${message}`);
    }
  }

  if (rows.length === 0) {
    throw new HttpError("UPSTREAM_ERROR", "No stock quotes could be fetched", { failed });
  }

  const snapshot = buildSnapshot(watchlist.map((entry) => entry.symbol), rows, now);
  await prisma.bannerSnapshot.create({
    data: { kind: "stocks", payload: snapshot as object, capturedAt: now, pushedBy: "system" },
  });
  await publishLiveEvent({ type: "banner.updated", kind: "stocks" });
  return { snapshot, failed };
}

/** Once a day: refresh the cached 6-month change of each watchlist symbol from Tiingo. */
export async function syncStockHistory(
  now: Date,
  options: { force?: boolean } = {},
): Promise<HistorySyncResult> {
  const watchlist = await readWatchlist();
  if (watchlist.length === 0) throw emptyWatchlistError();

  const updated: string[] = [];
  const skipped: string[] = [];
  const failed: StockSyncFailure[] = [];
  let tiingo: StocksApiConfig | null = null;

  for (const entry of watchlist) {
    if (recentlyAsked(entry.sixMonthAsOf, now) && !options.force) {
      skipped.push(entry.symbol);
      continue;
    }
    try {
      tiingo ??= loadTiingoConfig();
      await refreshSixMonth(entry.symbol, now, tiingo);
      updated.push(entry.symbol);
    } catch (error) {
      const message = describe(error);
      failed.push({ symbol: entry.symbol, message });
      console.warn(`[stocks] ${entry.symbol}: ${message}`);
    }
  }

  if (updated.length === 0 && failed.length > 0) {
    throw new HttpError("UPSTREAM_ERROR", "No stock history could be fetched", { failed });
  }
  // The cache is not what the page shows directly; the next quote sync publishes the banner update.
  return { updated, skipped, failed };
}
