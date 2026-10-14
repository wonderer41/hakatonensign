import type { Alert, Prisma } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import type { AlertInput } from "@/lib/hermes/parse";
import { publishLiveEvent } from "@/lib/live/publish";
import type { AlertDto, HermesWriteResult } from "@/types/dashboard-contracts";
import { retryOnUniqueViolation } from "./concurrency";
import { alertInclude, toAlertDto } from "./dto";
import { mergeMeta, sameJson } from "./json";

// Alerts are machine-owned (the Broken panel has no edit form), so there is no version check:
// the latest push wins. A push for a resolved alert reopens it — the problem came back.

async function loadAlertDto(id: string, now: Date): Promise<AlertDto> {
  return toAlertDto(await prisma.alert.findUniqueOrThrow({ where: { id }, include: alertInclude(now) }));
}

function alertChanges(row: Alert, input: AlertInput, now: Date): Prisma.AlertUpdateManyMutationInput | null {
  const data: Prisma.AlertUpdateManyMutationInput = {};
  if (input.source !== row.source) data.source = input.source;
  if (input.title !== row.title) data.title = input.title;
  if (input.detail !== undefined && input.detail !== row.detail) data.detail = input.detail;
  if (input.severity !== undefined && input.severity !== row.severity) data.severity = input.severity;
  if (input.meta !== undefined) {
    const merged = mergeMeta(row.meta, input.meta);
    if (!sameJson(merged, row.meta)) data.meta = merged as Prisma.InputJsonObject;
  }
  if (row.resolvedAt !== null) {
    data.resolvedAt = null;
    data.openedAt = now;
  }
  return Object.keys(data).length > 0 ? data : null;
}

/** Opens, updates or reopens the alert with this dedupeKey (PUT /api/hermes/alerts/:dedupeKey). */
export async function upsertAlert(dedupeKey: string, input: AlertInput, now = new Date()): Promise<HermesWriteResult<AlertDto>> {
  const outcome = await retryOnUniqueViolation(() =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.alert.findUnique({ where: { dedupeKey } });
      if (!existing) {
        const row = await tx.alert.create({
          data: {
            dedupeKey,
            source: input.source,
            title: input.title,
            detail: input.detail ?? null,
            severity: input.severity ?? "warning",
            meta: mergeMeta({}, input.meta ?? {}) as Prisma.InputJsonObject,
            openedAt: now,
          },
        });
        return { id: row.id, created: true, changed: true };
      }
      const data = alertChanges(existing, input, now);
      if (data) await tx.alert.update({ where: { id: existing.id }, data });
      return { id: existing.id, created: false, changed: data !== null };
    }),
  );

  const data = await loadAlertDto(outcome.id, now);
  if (outcome.changed) await publishLiveEvent({ type: "alert.changed", alertId: outcome.id });
  return { data, created: outcome.created };
}

/** Closes the alert (POST /api/hermes/alerts/:dedupeKey/resolve). Resolving twice changes nothing. */
export async function resolveAlert(dedupeKey: string, now = new Date()): Promise<HermesWriteResult<AlertDto>> {
  const existing = await prisma.alert.findUnique({ where: { dedupeKey }, select: { id: true } });
  if (!existing) throw new HttpError("NOT_FOUND", `No alert has dedupeKey ${dedupeKey}`);
  const { count } = await prisma.alert.updateMany({ where: { id: existing.id, resolvedAt: null }, data: { resolvedAt: now } });
  const data = await loadAlertDto(existing.id, now);
  if (count > 0) await publishLiveEvent({ type: "alert.changed", alertId: existing.id });
  return { data, created: false };
}
