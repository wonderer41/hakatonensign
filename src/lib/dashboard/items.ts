import type { Actor, ChecklistItem, Prisma } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import { describeRef, refWhere, type RowRef } from "@/lib/hermes/keys";
import type { ItemInput } from "@/lib/hermes/parse";
import { publishLiveEvent } from "@/lib/live/publish";
import type { ChecklistItemDto, HermesWriteResult } from "@/types/dashboard-contracts";
import { POSITION_GAP } from "./cards";
import { assertWritable, conflictError, retryOnUniqueViolation, VersionConflict } from "./concurrency";
import { itemInclude, toChecklistItemDto } from "./dto";

export async function loadItemDto(id: string, now = new Date()): Promise<ChecklistItemDto> {
  const row = await prisma.checklistItem.findUniqueOrThrow({ where: { id }, include: itemInclude(now) });
  return toChecklistItemDto(row);
}

async function nextItemPosition(tx: Prisma.TransactionClient, cardId: string): Promise<number> {
  const { _max } = await tx.checklistItem.aggregate({ where: { cardId }, _max: { position: true } });
  return (_max.position ?? 0) + POSITION_GAP;
}

/** Exactly one current item per card: clears isCurrent on the card's other items, returns their ids. */
async function clearCurrent(tx: Prisma.TransactionClient, cardId: string, keepId: string | null): Promise<string[]> {
  const rows = await tx.checklistItem.findMany({
    where: { cardId, isCurrent: true, ...(keepId ? { id: { not: keepId } } : {}) },
    select: { id: true },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  await tx.checklistItem.updateMany({ where: { id: { in: ids } }, data: { isCurrent: false, version: { increment: 1 } } });
  return ids;
}

function itemChanges(
  row: ChecklistItem,
  input: ItemInput,
  cardId: string,
  now: Date,
): { fields: string[]; data: Prisma.ChecklistItemUncheckedUpdateManyInput } {
  const fields: string[] = [];
  const data: Prisma.ChecklistItemUncheckedUpdateManyInput = {};
  const set = <K extends keyof ChecklistItem & keyof Prisma.ChecklistItemUncheckedUpdateManyInput>(
    field: K,
    value: ChecklistItem[K] | undefined,
  ) => {
    if (value === undefined || value === row[field]) return;
    fields.push(field);
    (data as Record<string, unknown>)[field] = value;
  };
  set("cardId", cardId);
  set("title", input.title);
  set("issueNumber", input.issueNumber);
  set("sourceUrl", input.sourceUrl);
  set("isCurrent", input.isCurrent);
  set("position", input.position);
  set("done", input.done);
  if (fields.includes("done")) data.doneAt = input.done ? now : null;
  return { fields, data };
}

interface Outcome {
  itemId: string;
  cardId: string;
  /** Set when the item moved here from another card. */
  previousCardId: string | null;
  created: boolean;
  changed: boolean;
  clearedIds: string[];
}

/**
 * Idempotent create/update of a checklist item (PUT /api/hermes/cards/:key/items/:itemKey).
 * Card and item may each be a key or an id. By key a missing item is created; by id it is 404.
 * An existing item named under another card moves to this card.
 */
export async function upsertItem(
  cardRef: RowRef,
  itemRef: RowRef,
  input: ItemInput,
  options: { actor?: Actor; now?: Date } = {},
): Promise<HermesWriteResult<ChecklistItemDto>> {
  const { actor = "hermes", now = new Date() } = options;
  const outcome = await retryOnUniqueViolation(async () => {
    try {
      return await prisma.$transaction(async (tx): Promise<Outcome> => {
        const card = await tx.workCard.findUnique({ where: refWhere(cardRef), select: { id: true } });
        if (!card) {
          const hint = cardRef.kind === "key" ? "; create it first with PUT /api/hermes/cards/:key" : "";
          throw new HttpError("NOT_FOUND", `No card has ${describeRef(cardRef)}${hint}`);
        }

        const existing = await tx.checklistItem.findUnique({ where: refWhere(itemRef) });
        if (!existing) {
          if (itemRef.kind === "id") throw new HttpError("NOT_FOUND", `No item has ${describeRef(itemRef)}`);
          const done = input.done ?? false;
          const isCurrent = input.isCurrent ?? false;
          const clearedIds = isCurrent ? await clearCurrent(tx, card.id, null) : [];
          const row = await tx.checklistItem.create({
            data: {
              cardId: card.id,
              externalKey: itemRef.key,
              title: input.title,
              issueNumber: input.issueNumber ?? null,
              sourceUrl: input.sourceUrl ?? null,
              done,
              doneAt: done ? now : null,
              isCurrent,
              position: input.position ?? (await nextItemPosition(tx, card.id)),
              createdBy: actor,
            },
          });
          return { itemId: row.id, cardId: card.id, previousCardId: null, created: true, changed: true, clearedIds };
        }

        const moved = existing.cardId !== card.id;
        const changes = itemChanges(existing, input, card.id, now);
        if (changes.fields.length === 0) {
          return { itemId: existing.id, cardId: card.id, previousCardId: null, created: false, changed: false, clearedIds: [] };
        }
        assertWritable(input, existing.version, changes.fields, changes.fields.includes("done") ? ["done"] : []);

        if (moved && input.position === undefined) changes.data.position = await nextItemPosition(tx, card.id);
        const willBeCurrent = input.isCurrent ?? existing.isCurrent;
        const clearedIds = willBeCurrent && (moved || changes.fields.includes("isCurrent")) ? await clearCurrent(tx, card.id, existing.id) : [];
        const updated = await tx.checklistItem.updateMany({
          where: { id: existing.id, version: existing.version },
          data: { ...changes.data, version: { increment: 1 } },
        });
        if (updated.count === 0) throw new VersionConflict("stale_version", changes.fields, existing.version + 1, input.version);
        return {
          itemId: existing.id,
          cardId: card.id,
          previousCardId: moved ? existing.cardId : null,
          created: false,
          changed: true,
          clearedIds,
        };
      });
    } catch (error) {
      if (!(error instanceof VersionConflict)) throw error;
      const current = await prisma.checklistItem.findUniqueOrThrow({ where: refWhere(itemRef), include: itemInclude(now) });
      throw conflictError("item", new VersionConflict(error.reason, error.fields, current.version, error.sentVersion), toChecklistItemDto(current));
    }
  });

  const data = await loadItemDto(outcome.itemId, now);
  if (outcome.changed) {
    await publishLiveEvent({ type: "item.upserted", cardId: outcome.cardId, itemId: outcome.itemId });
    for (const itemId of outcome.clearedIds) await publishLiveEvent({ type: "item.upserted", cardId: outcome.cardId, itemId });
    if (outcome.previousCardId) await publishLiveEvent({ type: "card.upserted", cardId: outcome.previousCardId });
  }
  return { data, created: outcome.created };
}
