import type { Actor, Prisma, WorkCard } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import { describeRef, refWhere, type RowRef } from "@/lib/hermes/keys";
import type { CardInput } from "@/lib/hermes/parse";
import { publishLiveEvent } from "@/lib/live/publish";
import type { HermesWriteResult, WorkCardDto } from "@/types/dashboard-contracts";
import { assertWritable, conflictError, retryOnUniqueViolation, VersionConflict } from "./concurrency";
import { cardInclude, toWorkCardDto } from "./dto";
import { mergeMeta, sameJson } from "./json";
import { findSprintIdByKey } from "./sprints";

/** Positions are integers with gaps of 1000. */
export const POSITION_GAP = 1000;

export async function loadCardDto(id: string, now = new Date()): Promise<WorkCardDto> {
  const row = await prisma.workCard.findUniqueOrThrow({ where: { id }, include: cardInclude(now) });
  return toWorkCardDto(row);
}

async function nextCardPosition(tx: Prisma.TransactionClient): Promise<number> {
  const { _max } = await tx.workCard.aggregate({ _max: { position: true } });
  return (_max.position ?? 0) + POSITION_GAP;
}

async function resolveSprintId(tx: Prisma.TransactionClient, sprintRef: RowRef | null | undefined): Promise<string | null | undefined> {
  if (sprintRef === undefined || sprintRef === null) return sprintRef;
  const id = await findSprintIdByKey(tx, sprintRef);
  if (!id) {
    const hint = sprintRef.kind === "key" ? "; create it first with PUT /api/hermes/sprints/:key" : "";
    throw new HttpError("NOT_FOUND", `No sprint has ${describeRef(sprintRef)}${hint}`, { field: "sprintKey" });
  }
  return id;
}

function cardChanges(
  row: WorkCard,
  input: CardInput,
  sprintId: string | null | undefined,
): { fields: string[]; data: Prisma.WorkCardUncheckedUpdateManyInput } {
  const fields: string[] = [];
  const data: Prisma.WorkCardUncheckedUpdateManyInput = {};
  const set = <K extends keyof WorkCard & keyof Prisma.WorkCardUncheckedUpdateManyInput>(field: K, value: WorkCard[K] | undefined) => {
    if (value === undefined || value === row[field]) return;
    fields.push(field);
    (data as Record<string, unknown>)[field] = value;
  };
  set("title", input.title);
  set("repoFullName", input.repoFullName);
  set("milestoneTitle", input.milestoneTitle);
  set("sprintId", sprintId);
  set("status", input.status);
  set("position", input.position);
  set("hermesSuggestion", input.hermesSuggestion);
  if (input.meta !== undefined) {
    const merged = mergeMeta(row.meta, input.meta);
    if (!sameJson(merged, row.meta)) {
      fields.push("meta");
      data.meta = merged as Prisma.InputJsonObject;
    }
  }
  return { fields, data };
}

interface Outcome {
  id: string;
  created: boolean;
  changed: boolean;
}

/**
 * Idempotent create/update of a Working-on card (PUT /api/hermes/cards/:key). By key it creates
 * the card when missing; by id (page-created cards) it only updates, and a missing id is 404.
 */
export async function upsertCard(
  ref: RowRef,
  input: CardInput,
  options: { actor?: Actor; now?: Date } = {},
): Promise<HermesWriteResult<WorkCardDto>> {
  const { actor = "hermes", now = new Date() } = options;
  const outcome = await retryOnUniqueViolation(async () => {
    try {
      return await prisma.$transaction(async (tx): Promise<Outcome> => {
        const sprintId = await resolveSprintId(tx, input.sprintKey);
        const existing = await tx.workCard.findUnique({ where: refWhere(ref) });
        if (!existing) {
          if (ref.kind === "id") throw new HttpError("NOT_FOUND", `No card has ${describeRef(ref)}`);
          const row = await tx.workCard.create({
            data: {
              externalKey: ref.key,
              title: input.title,
              repoFullName: input.repoFullName ?? null,
              milestoneTitle: input.milestoneTitle ?? null,
              sprintId: sprintId ?? null,
              status: input.status ?? "active",
              position: input.position ?? (await nextCardPosition(tx)),
              hermesSuggestion: input.hermesSuggestion ?? null,
              meta: mergeMeta({}, input.meta ?? {}) as Prisma.InputJsonObject,
              createdBy: actor,
            },
          });
          return { id: row.id, created: true, changed: true };
        }

        const changes = cardChanges(existing, input, sprintId);
        if (changes.fields.length === 0) return { id: existing.id, created: false, changed: false };
        assertWritable(input, existing.version, changes.fields);
        const updated = await tx.workCard.updateMany({
          where: { id: existing.id, version: existing.version },
          data: { ...changes.data, version: { increment: 1 } },
        });
        if (updated.count === 0) throw new VersionConflict("stale_version", changes.fields, existing.version + 1, input.version);
        return { id: existing.id, created: false, changed: true };
      });
    } catch (error) {
      if (!(error instanceof VersionConflict)) throw error;
      const current = await prisma.workCard.findUniqueOrThrow({ where: refWhere(ref), include: cardInclude(now) });
      throw conflictError("card", new VersionConflict(error.reason, error.fields, current.version, error.sentVersion), toWorkCardDto(current));
    }
  });

  const data = await loadCardDto(outcome.id, now);
  if (outcome.changed) await publishLiveEvent({ type: "card.upserted", cardId: outcome.id });
  return { data, created: outcome.created };
}

/**
 * POST /api/hermes/cards/:key/archive. Hermes never hard-deletes; archiving is an explicit
 * instruction, so it needs no version. Archiving an archived card changes nothing.
 */
export async function archiveCard(ref: RowRef, now = new Date()): Promise<HermesWriteResult<WorkCardDto>> {
  const existing = await prisma.workCard.findUnique({ where: refWhere(ref), select: { id: true } });
  if (!existing) throw new HttpError("NOT_FOUND", `No card has ${describeRef(ref)}`);
  const { count } = await prisma.workCard.updateMany({
    where: { id: existing.id, status: { not: "archived" } },
    data: { status: "archived", version: { increment: 1 } },
  });
  const data = await loadCardDto(existing.id, now);
  if (count > 0) await publishLiveEvent({ type: "card.upserted", cardId: existing.id });
  return { data, created: false };
}
