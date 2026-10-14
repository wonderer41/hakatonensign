import type { ChecklistItem, Prisma } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import { publishLiveEvent } from "@/lib/live/publish";
import type { ChecklistItemDto } from "@/types/dashboard-contracts";
import { POSITION_GAP } from "./cards";
import { VersionConflict } from "./concurrency";
import { itemInclude, toChecklistItemDto } from "./dto";
import { loadItemDto } from "./items";
import { assertKnownIds, planReorder } from "./reorder";
import { staleEditError } from "./user-conflict";
import type { CreateItemInput, UpdateItemInput } from "./user-parse";

// Browser routes for checklist items (/api/cards/:id/items, /api/items/:id). The checkbox is a
// PATCH { done } here; "now" is a PATCH { isCurrent: true }, which clears it on the card's other
// items in the same transaction (exactly one current item per card).

const BY_POSITION = [{ position: "asc" }, { createdAt: "asc" }] satisfies Prisma.ChecklistItemOrderByWithRelationInput[];

async function assertCardExists(tx: Prisma.TransactionClient, cardId: string): Promise<void> {
  const card = await tx.workCard.findUnique({ where: { id: cardId }, select: { id: true } });
  if (!card) throw new HttpError("NOT_FOUND", `No card has id ${cardId}`);
}

async function publishItems(cardId: string, itemIds: string[]): Promise<void> {
  for (const itemId of itemIds) await publishLiveEvent({ type: "item.upserted", cardId, itemId });
}

/** POST /api/cards/:id/items. Appended after the card's last item unless a position is given. */
export async function createItem(cardId: string, input: CreateItemInput, now = new Date()): Promise<ChecklistItemDto> {
  const row = await prisma.$transaction(async (tx) => {
    await assertCardExists(tx, cardId);
    const position =
      input.position ?? ((await tx.checklistItem.aggregate({ where: { cardId }, _max: { position: true } }))._max.position ?? 0) + POSITION_GAP;
    return tx.checklistItem.create({
      data: {
        cardId,
        title: input.title,
        issueNumber: input.issueNumber,
        sourceUrl: input.sourceUrl,
        position,
        createdBy: "user",
      },
    });
  });
  await publishItems(cardId, [row.id]);
  return loadItemDto(row.id, now);
}

function itemChanges(row: ChecklistItem, input: UpdateItemInput, now: Date): { fields: string[]; data: Prisma.ChecklistItemUncheckedUpdateManyInput } {
  const fields: string[] = [];
  const data: Prisma.ChecklistItemUncheckedUpdateManyInput = {};
  if (input.title !== undefined && input.title !== row.title) {
    fields.push("title");
    data.title = input.title;
  }
  if (input.done !== undefined && input.done !== row.done) {
    fields.push("done");
    data.done = input.done;
    data.doneAt = input.done ? now : null;
  }
  if (input.isCurrent !== undefined && input.isCurrent !== row.isCurrent) {
    fields.push("isCurrent");
    data.isCurrent = input.isCurrent;
  }
  if (input.position !== undefined && input.position !== row.position) {
    fields.push("position");
    data.position = input.position;
  }
  return { fields, data };
}

interface UpdateOutcome {
  cardId: string;
  changed: boolean;
  /** Siblings whose isCurrent was cleared. */
  clearedIds: string[];
}

/** PATCH /api/items/:id. Needs the version the page last read (D15). */
export async function updateItem(id: string, input: UpdateItemInput, now = new Date()): Promise<ChecklistItemDto> {
  let outcome: UpdateOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<UpdateOutcome> => {
      const row = await tx.checklistItem.findUnique({ where: { id } });
      if (!row) throw new HttpError("NOT_FOUND", `No checklist item has id ${id}`);

      const changes = itemChanges(row, input, now);
      // Nothing to change: answer with the current item, whatever version was sent.
      if (changes.fields.length === 0) return { cardId: row.cardId, changed: false, clearedIds: [] };
      if (input.version !== row.version) throw new VersionConflict("stale_version", changes.fields, row.version, input.version);

      const updated = await tx.checklistItem.updateMany({ where: { id, version: row.version }, data: { ...changes.data, version: { increment: 1 } } });
      if (updated.count === 0) throw new VersionConflict("stale_version", changes.fields, row.version + 1, input.version);

      let clearedIds: string[] = [];
      if (changes.data.isCurrent === true) {
        const siblings = await tx.checklistItem.findMany({ where: { cardId: row.cardId, isCurrent: true, id: { not: id } }, select: { id: true } });
        clearedIds = siblings.map((sibling) => sibling.id);
        if (clearedIds.length > 0) {
          await tx.checklistItem.updateMany({ where: { id: { in: clearedIds } }, data: { isCurrent: false, version: { increment: 1 } } });
        }
      }
      return { cardId: row.cardId, changed: true, clearedIds };
    });
  } catch (error) {
    if (!(error instanceof VersionConflict)) throw error;
    throw staleEditError("checklist item", error, await loadItemDto(id, now));
  }

  if (outcome.changed) await publishItems(outcome.cardId, [id, ...outcome.clearedIds]);
  return loadItemDto(id, now);
}

/**
 * POST /api/cards/:id/items/reorder. `ids` are items of this card in their new order; every item's
 * position is rewritten (1000, 2000, …) in one transaction, unlisted items after the listed ones.
 * Moved items get a version bump. Returns the card's items in their new order.
 */
export async function reorderItems(cardId: string, ids: string[], now = new Date()): Promise<ChecklistItemDto[]> {
  const movedIds = await prisma.$transaction(async (tx) => {
    await assertCardExists(tx, cardId);
    const rows = await tx.checklistItem.findMany({ where: { cardId }, orderBy: BY_POSITION, select: { id: true, position: true } });
    assertKnownIds(ids, rows, "an item of this card (reload the card)");
    const { updates } = planReorder(rows, ids, POSITION_GAP);
    for (const update of updates) {
      await tx.checklistItem.update({ where: { id: update.id }, data: { position: update.position, version: { increment: 1 } } });
    }
    return updates.map((update) => update.id);
  });

  await publishItems(cardId, movedIds);
  const rows = await prisma.checklistItem.findMany({ where: { cardId }, orderBy: BY_POSITION, include: itemInclude(now) });
  return rows.map(toChecklistItemDto);
}
