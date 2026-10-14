// Background jobs for Homelab Daily (decision D12: a separate worker container, same image).
// Usage: npm run worker   — stop with Ctrl+C / SIGTERM; the running job finishes first.
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { safeErrorMessage } from "@/lib/live/redact";
import { dashboardTimeZone, formatClock, localDateString } from "@/lib/time/zone";
import { workerJobs } from "@/lib/worker/jobs";
import { Scheduler } from "@/lib/worker/scheduler";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is not configured");
  const timeZone = dashboardTimeZone();
  const scheduler = new Scheduler({ timeZone });
  for (const job of workerJobs) scheduler.register(job);

  let stopping = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (stopping) {
      console.error(`[worker] ${signal} again, exiting without waiting`);
      process.exit(1);
    }
    stopping = true;
    console.log(`[worker] ${signal} received, finishing running jobs`);
    await scheduler.stop();
    await prisma.$disconnect().catch(() => {});
    console.log("[worker] stopped");
    process.exit(0);
  };
  process.on("SIGTERM", (signal) => void shutdown(signal));
  process.on("SIGINT", (signal) => void shutdown(signal));

  scheduler.start();
  const plan = scheduler
    .nextRuns()
    .map(({ name, trigger, nextAt }) => {
      const next = nextAt && nextAt.getTime() > Date.now() + 1_000 ? `, next ${localDateString(nextAt, timeZone)} ${formatClock(nextAt, timeZone)}` : "";
      return `${name} (${trigger}${next})`;
    })
    .join(" · ");
  console.log(`[worker] started in ${timeZone}: ${plan}`);
}

main().catch((error: unknown) => {
  console.error(`[worker] failed to start: ${safeErrorMessage(error)}`);
  process.exit(1);
});
