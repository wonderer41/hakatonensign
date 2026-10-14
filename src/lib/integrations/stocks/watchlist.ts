import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";

const POSITION_GAP = 1000;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/;

export interface WatchlistEntry {
  symbol: string;
  sixMonthChangePct: number | null;
  sixMonthAsOf: Date | null;
}

export async function readWatchlist(): Promise<WatchlistEntry[]> {
  const rows = await prisma.watchlistSymbol.findMany({
    orderBy: [{ position: "asc" }, { symbol: "asc" }],
    select: { symbol: true, sixMonthChangePct: true, sixMonthAsOf: true },
  });
  return rows;
}

/** Uppercases, validates and de-duplicates (first occurrence wins). */
export function normalizeSymbols(input: string[]): string[] {
  const symbols = [...new Set(input.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const invalid = symbols.filter((symbol) => !SYMBOL_PATTERN.test(symbol));
  if (invalid.length) throw new HttpError("VALIDATION_ERROR", `Invalid symbol(s): ${invalid.join(", ")}`);
  if (symbols.length === 0) throw new HttpError("VALIDATION_ERROR", "Provide at least one symbol");
  return symbols;
}

/** Replaces the whole list. Symbols that stay keep their cached 6M value. */
export async function replaceWatchlist(input: string[]): Promise<string[]> {
  const symbols = normalizeSymbols(input);
  await prisma.$transaction([
    prisma.watchlistSymbol.deleteMany({ where: { symbol: { notIn: symbols } } }),
    ...symbols.map((symbol, index) =>
      prisma.watchlistSymbol.upsert({
        where: { symbol },
        create: { symbol, position: (index + 1) * POSITION_GAP, addedBy: "user" },
        update: { position: (index + 1) * POSITION_GAP, addedBy: "user" },
      }),
    ),
  ]);
  return symbols;
}

export function emptyWatchlistError(): HttpError {
  return new HttpError(
    "VALIDATION_ERROR",
    "The watchlist is empty. Set it with: npm run stocks:watchlist -- NVDA AMD MU ...",
  );
}
