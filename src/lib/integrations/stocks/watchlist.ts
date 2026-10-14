import type { Actor } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import { SYMBOL_PATTERN } from "./symbols";

const POSITION_GAP = 1000;

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

export interface WatchlistReplaceResult {
  symbols: string[];
  /** False when the stored list already had exactly these symbols in this order. */
  changed: boolean;
}

/**
 * Replaces the whole list. Symbols that stay keep their cached 6M value and their addedBy;
 * new ones are recorded as added by `actor`.
 */
export async function replaceWatchlist(input: string[], actor: Actor = "user"): Promise<WatchlistReplaceResult> {
  const symbols = normalizeSymbols(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.watchlistSymbol.findMany({ orderBy: [{ position: "asc" }, { symbol: "asc" }], select: { symbol: true } });
    const changed = before.length !== symbols.length || before.some((row, index) => row.symbol !== symbols[index]);
    if (!changed) return { symbols, changed };
    await tx.watchlistSymbol.deleteMany({ where: { symbol: { notIn: symbols } } });
    for (const [index, symbol] of symbols.entries()) {
      await tx.watchlistSymbol.upsert({
        where: { symbol },
        create: { symbol, position: (index + 1) * POSITION_GAP, addedBy: actor },
        update: { position: (index + 1) * POSITION_GAP },
      });
    }
    return { symbols, changed };
  });
}

export function emptyWatchlistError(): HttpError {
  return new HttpError(
    "VALIDATION_ERROR",
    "The watchlist is empty. Set it with: npm run stocks:watchlist -- NVDA AMD MU ...",
  );
}
