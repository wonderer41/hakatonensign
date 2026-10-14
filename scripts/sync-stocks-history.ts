// Refreshes the cached 6-month change of each watchlist symbol from Tiingo.
// Usage: npm run sync:stocks:history [-- --force]
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { syncStockHistory } from "@/lib/integrations/stocks/sync";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const result = await syncStockHistory(new Date(), { force });
  console.log(`Stock history${force ? " (forced)" : ""}`);
  console.log(`  updated ${result.updated.length}${result.updated.length ? ` · ${result.updated.join(", ")}` : ""}`);
  console.log(`  skipped ${result.skipped.length}${result.skipped.length ? ` (fresh, under 20 h) · ${result.skipped.join(", ")}` : ""}`);
  for (const item of result.failed) console.log(`  failed  ${item.symbol}: ${item.message}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
