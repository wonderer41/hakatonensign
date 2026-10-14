// Runs one Finnhub quote sync and prints the rows as the banner shows them.
// Usage: npm run sync:stocks
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { formatChange } from "@/lib/integrations/stocks/compute";
import { syncStockQuotes } from "@/lib/integrations/stocks/sync";
import { dashboardTimeZone, formatClock, localDateString } from "@/lib/time/zone";

async function main(): Promise<void> {
  const timeZone = dashboardTimeZone();
  const now = new Date();
  const { snapshot, failed } = await syncStockQuotes(now);

  console.log(`Stocks · ${localDateString(now, timeZone)} ${formatClock(now, timeZone)} (${timeZone})`);
  console.log(`${"Symbol".padEnd(8)}${"Price".padStart(11)}  ${"Day".padEnd(10)}6M`);
  for (const row of snapshot.rows) {
    const price = `${row.price.toFixed(2)}`.padStart(11);
    console.log(`${row.symbol.padEnd(8)}${price}  ${formatChange(row.dayChangePct).padEnd(10)}${formatChange(row.sixMonthChangePct)}`);
  }
  for (const item of failed) console.log(`  failed ${item.symbol}: ${item.message}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
