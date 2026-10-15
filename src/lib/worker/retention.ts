import type { PrismaClient } from "@/generated/prisma/client";
import { addDays, dayBounds, localDateString } from "@/lib/time/zone";

// How long each kind of row is kept.
export const RETENTION_DAYS = {
  bannerSnapshot: 14,
  scheduleRequest: 30,
  calendarEvent: 60,
  resolvedAlert: 30,
} as const;

export type RetentionCutoffs = Record<keyof typeof RETENTION_DAYS, Date>;

export interface RetentionResult {
  bannerSnapshots: number;
  scheduleRequests: number;
  calendarEvents: number;
  resolvedAlerts: number;
}

/**
 * Rows older than the cutoff are deleted. Each cutoff is local midnight N days before today in
 * the dashboard zone, so "keep 14 days" means today plus the 14 previous local dates, DST included.
 */
export function retentionCutoffs(now: Date, timeZone: string): RetentionCutoffs {
  const today = localDateString(now, timeZone);
  const cutoff = (days: number) => dayBounds(addDays(today, -days), timeZone).start;
  return {
    bannerSnapshot: cutoff(RETENTION_DAYS.bannerSnapshot),
    scheduleRequest: cutoff(RETENTION_DAYS.scheduleRequest),
    calendarEvent: cutoff(RETENTION_DAYS.calendarEvent),
    resolvedAlert: cutoff(RETENTION_DAYS.resolvedAlert),
  };
}

export function formatRetentionResult(result: RetentionResult): string {
  return `deleted bannerSnapshots ${result.bannerSnapshots} · scheduleRequests ${result.scheduleRequests} · calendarEvents ${result.calendarEvents} · resolvedAlerts ${result.resolvedAlerts}`;
}

type RetentionDb = Pick<PrismaClient, "bannerSnapshot" | "scheduleRequest" | "calendarEvent" | "alert" | "$transaction">;

/**
 * Deletes what the retention rules allow. Nothing the page currently shows is removed: the newest
 * snapshot of each banner kind is always kept (even if older than 14 days), and only resolved
 * alerts and calendar events that ended before the cutoff go.
 */
export async function runRetention(db: RetentionDb, now: Date, timeZone: string): Promise<RetentionResult> {
  const cutoffs = retentionCutoffs(now, timeZone);
  // One indexed findFirst per kind: Prisma's `distinct` would read the whole table.
  const latestPerKind = (
    await Promise.all(
      (["gmail", "orphans", "scan", "stocks"] as const).map((kind) =>
        db.bannerSnapshot.findFirst({ where: { kind }, orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }], select: { id: true } }),
      ),
    )
  ).filter((row): row is { id: string } => row !== null);

  const [bannerSnapshots, scheduleRequests, calendarEvents, resolvedAlerts] = await db.$transaction([
    db.bannerSnapshot.deleteMany({
      where: { capturedAt: { lt: cutoffs.bannerSnapshot }, id: { notIn: latestPerKind.map((row) => row.id) } },
    }),
    db.scheduleRequest.deleteMany({ where: { createdAt: { lt: cutoffs.scheduleRequest } } }),
    db.calendarEvent.deleteMany({ where: { endsAt: { lt: cutoffs.calendarEvent } } }),
    db.alert.deleteMany({ where: { resolvedAt: { not: null, lt: cutoffs.resolvedAlert } } }),
  ]);

  return {
    bannerSnapshots: bannerSnapshots.count,
    scheduleRequests: scheduleRequests.count,
    calendarEvents: calendarEvents.count,
    resolvedAlerts: resolvedAlerts.count,
  };
}
