import type { StocksSnapshot } from "@/types/dashboard-contracts";
import { isDateString } from "@/lib/time/zone";
import type { DailyPrice } from "./tiingo";

/** Every default symbol is US-listed and Finnhub's quote carries no currency field. */
export const STOCK_CURRENCY = "USD";

export type StockRow = StocksSnapshot["rows"][number];

/** The calendar date six months before `today` (YYYY-MM-DD), clamped to that month's last day. */
export function sixMonthsBefore(today: string): string {
  if (!isDateString(today)) throw new Error(`"${today}" is not a YYYY-MM-DD date`);
  const [year, month, day] = today.split("-").map(Number);
  const targetMonth = month - 6; // may be <= 0; Date.UTC rolls the year back
  const lastDay = new Date(Date.UTC(year, targetMonth, 0)).getUTCDate();
  return new Date(Date.UTC(year, targetMonth - 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/**
 * 6M change in percent: latest adjClose against the adjClose on the first trading day on/after
 * the date six months before `today`. Null when the series is empty or has no usable base.
 */
export function sixMonthChangePct(prices: DailyPrice[], today: string): number | null {
  const start = sixMonthsBefore(today);
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const base = sorted.find((price) => price.date >= start);
  const latest = sorted[sorted.length - 1];
  if (!base || !latest || base.adjClose <= 0) return null;
  return (latest.adjClose / base.adjClose - 1) * 100;
}

export function buildRow(
  symbol: string,
  quote: { price: number; dayChangePct: number },
  sixMonthChangePct: number | null,
): StockRow {
  return {
    symbol,
    price: quote.price,
    currency: STOCK_CURRENCY,
    dayChangePct: quote.dayChangePct,
    sixMonthChangePct,
  };
}

/** Rows ordered like the watchlist, skipping symbols that failed. */
export function buildSnapshot(order: string[], rows: StockRow[], now: Date): StocksSnapshot {
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  return {
    asOf: now.toISOString(),
    rows: order.flatMap((symbol) => {
      const row = bySymbol.get(symbol);
      return row ? [row] : [];
    }),
  };
}

/** "▲ +1.2%" / "▼ −3.4%" as the banner shows it; "—" when there is no value yet. */
export function formatChange(pct: number | null): string {
  if (pct === null) return "—";
  const rounded = Math.round(Math.abs(pct) * 10) / 10;
  if (pct >= 0 || rounded === 0) return `▲ +${rounded.toFixed(1)}%`;
  return `▼ −${rounded.toFixed(1)}%`;
}
