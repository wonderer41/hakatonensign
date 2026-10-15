import { formatClock, localDateString } from "@/lib/time/zone";
import type { Actor } from "@/types/dashboard-contracts";

const MINUS = "−"; // "−", not a hyphen: the design asks for "▼ −x.x%"

/** "08:00" for an instant on the same local day as `now`, otherwise "Oct 13, 18:00". */
export function formatClockOrDay(at: Date, now: Date, timeZone: string): string {
  if (Number.isNaN(at.getTime())) return "";
  const clock = formatClock(at, timeZone);
  if (localDateString(at, timeZone) === localDateString(now, timeZone)) return clock;
  const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(at);
  return `${day}, ${clock}`;
}

/** The author line under the daily message: "— Hermes" / "— you". */
export function authorLabel(author: Actor): string {
  switch (author) {
    case "hermes":
      return "Hermes";
    case "user":
      return "you";
    case "github":
      return "GitHub";
    case "system":
      return "system";
  }
}

export type ChangeDirection = "up" | "down" | "flat";

export interface StockChange {
  direction: ChangeDirection;
  /** What the cell shows: "▲ +1.4%", "▼ −0.8%", "▬ 0.0%". The sign and arrow carry the meaning, not the colour. */
  text: string;
  /** What a screen reader hears instead of the glyphs: "up 1.4 percent". */
  spoken: string;
}

const ONE_DECIMAL = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Percent change with one decimal. A change that rounds to 0.0 is flat, whatever its sign. */
export function formatChange(pct: number): StockChange {
  const magnitude = Number.isFinite(pct) ? ONE_DECIMAL.format(Math.abs(pct)) : "0.0";
  if (!Number.isFinite(pct) || Number.parseFloat(magnitude.replaceAll(",", "")) === 0) {
    return { direction: "flat", text: "▬ 0.0%", spoken: "unchanged" };
  }
  if (pct > 0) return { direction: "up", text: `▲ +${magnitude}%`, spoken: `up ${magnitude} percent` };
  return { direction: "down", text: `▼ ${MINUS}${magnitude}%`, spoken: `down ${magnitude} percent` };
}

const PRICE = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PRICE_SMALL = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** 1,234.56; prices under 1 get four decimals so they don't read as 0.00. No currency symbol (see sameCurrency). */
export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "–";
  return (price < 1 ? PRICE_SMALL : PRICE).format(price);
}

/** The shared currency code when every row uses the same one (shown once in the slide header), else null. */
export function sameCurrency(rows: readonly { currency: string }[]): string | null {
  const first = rows[0]?.currency;
  if (!first) return null;
  return rows.every((row) => row.currency === first) ? first : null;
}

/** Splits into columns of `size`; the last one may be shorter. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const columns: T[][] = [];
  for (let start = 0; start < items.length; start += size) columns.push(items.slice(start, start + size));
  return columns;
}

/** The first `cap` rows and how many were left out ("+3 more"). */
export function capRows<T>(items: readonly T[], cap: number): { shown: T[]; hidden: number } {
  return { shown: items.slice(0, cap), hidden: Math.max(0, items.length - cap) };
}

/** "1 issue" / "2 issues". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
