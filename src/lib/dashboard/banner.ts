import type { Actor, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { publishLiveEvent } from "@/lib/live/publish";
import type { BannerKind, HermesBannerResult, HermesDailyMessage, HermesWriteResult } from "@/types/dashboard-contracts";
import { parseSnapshotPayload } from "./banner-payload";
import { retryOnUniqueViolation } from "./concurrency";
import { dateOnly, toDbDate } from "./dto";
import { sameJson } from "./json";

/**
 * Validates and stores a banner snapshot (PUT /api/hermes/banner/:kind). History is kept, one
 * row per capture. Re-sending the same (kind, capturedAt) is idempotent: an identical payload
 * changes nothing; a different one replaces that capture's payload.
 */
export async function insertBannerSnapshot(
  kind: BannerKind,
  rawPayload: unknown,
  capturedAt: Date,
  pushedBy: Actor = "hermes",
): Promise<HermesWriteResult<HermesBannerResult>> {
  const payload = parseSnapshotPayload(kind, rawPayload);

  // (kind, capturedAt) is unique: a retried PUT racing the first one loses the create and takes the update path.
  const outcome = await retryOnUniqueViolation(async () => {
    const existing = await prisma.bannerSnapshot.findUnique({
      where: { kind_capturedAt: { kind, capturedAt } },
      select: { id: true, payload: true },
    });
    if (!existing) {
      await prisma.bannerSnapshot.create({ data: { kind, payload: payload as unknown as Prisma.InputJsonObject, capturedAt, pushedBy } });
      return { created: true, changed: true };
    }
    if (sameJson(existing.payload, payload)) return { created: false, changed: false };
    await prisma.bannerSnapshot.update({ where: { id: existing.id }, data: { payload: payload as unknown as Prisma.InputJsonObject, pushedBy } });
    return { created: false, changed: true };
  });

  if (outcome.changed) await publishLiveEvent({ type: "banner.updated", kind });
  return { data: { kind, capturedAt: capturedAt.toISOString(), data: payload }, created: outcome.created };
}

/** Writes the banner's daily message for a local date (PUT /api/hermes/daily-message/:date, D13). */
export async function setDailyMessage(date: string, text: string, author: Actor): Promise<HermesWriteResult<HermesDailyMessage>> {
  const key = toDbDate(date);
  const outcome = await retryOnUniqueViolation(async () => {
    const existing = await prisma.dailyMessage.findUnique({ where: { date: key } });
    if (!existing) {
      await prisma.dailyMessage.create({ data: { date: key, text, author } });
      return { created: true, changed: true };
    }
    if (existing.text === text && existing.author === author) return { created: false, changed: false };
    await prisma.dailyMessage.update({ where: { date: key }, data: { text, author } });
    return { created: false, changed: true };
  });

  if (outcome.changed) await publishLiveEvent({ type: "banner.updated", kind: "dailyMessage" });
  return { data: { date: dateOnly(key), text, author }, created: outcome.created };
}
