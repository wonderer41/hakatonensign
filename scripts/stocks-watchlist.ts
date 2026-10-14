// Replaces the whole stocks watchlist.
// Usage: npm run stocks:watchlist -- NVDA AMD MU TSLA ...
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { readWatchlist, replaceWatchlist } from "@/lib/integrations/stocks/watchlist";

async function main(): Promise<void> {
  const symbols = process.argv.slice(2).flatMap((arg) => arg.split(/[\s,]+/));
  const { symbols: saved, changed } = await replaceWatchlist(symbols, "user");
  console.log(`Watchlist (${saved.length})${changed ? "" : " unchanged"}: ${saved.join(" ")}`);
  const missing = (await readWatchlist()).filter((entry) => entry.sixMonthChangePct === null).map((entry) => entry.symbol);
  if (missing.length) console.log(`  no cached 6M yet: ${missing.join(", ")} (npm run sync:stocks:history, or the next sync:stocks fetches it)`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
