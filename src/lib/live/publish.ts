import { prisma } from "@/lib/db/prisma";
import type { LiveEvent } from "@/types/dashboard-contracts";
import { LIVE_CHANNEL } from "./channel";
import { serializeLiveEvent } from "./event";
import { safeErrorMessage } from "./redact";

/**
 * Every write that changes what the page shows calls this after its DB commit.
 * It sends the event with Postgres NOTIFY so every
 * app process (and therefore every open /api/stream) sees it, whichever process wrote.
 * Never throws: a lost live update must not fail the write that triggered it.
 */
export async function publishLiveEvent(event: LiveEvent): Promise<void> {
  try {
    await sendLiveEvent(event);
  } catch (error) {
    const type = typeof event?.type === "string" ? event.type : "unknown";
    console.error(`[live] publish ${type} failed: ${safeErrorMessage(error)}`);
  }
}

/** Strict variant for jobs whose only effect is the event (e.g. day-rollover): throws on failure. */
export async function sendLiveEvent(event: LiveEvent): Promise<void> {
  const payload = serializeLiveEvent(event);
  await prisma.$executeRaw`SELECT pg_notify(${LIVE_CHANNEL}, ${payload})`;
}
