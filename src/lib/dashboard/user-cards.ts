import type { CardStatus, Prisma, WorkCard } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import { publishLiveEvent } from "@/lib/live/publish";
import type { WorkCardDto } from "@/types/dashboard-contracts";
import { loadCardDto, POSITION_GAP } from "./cards";
import { VersionConflict } from "./concurrency";
import { cardInclude, toWorkCardDto } from "./dto";
import { assertKnownIds, planReorder } from "./reorder";
import { staleEditError } from "./user-conflict";
import type { CreateCardInput, UpdateCardInput } from "./user-parse";
import { assertSprintExists } from "./user-sprints";

// Browser routes for Working-on cards (/api/cards). Cards are never deleted here: the page
// archives them with PATCH { status: "archived" } (soft delete).

const BY_POSITION = [{ position: "asc" }, { createdAt: "asc" }] satisfies Prisma.WorkCardOrderByWithRelationInput[];

/** The cards the column shows (and reorders): every card that is not archived. */
const VISIBLE = { status: { not: "archived" } } satisfies Prisma.WorkCardWhereInput;

/** GET /api/cards?status=&sprintId=, ordered by position. Without status: every card that is not archived. */
export async function listCards(filter: { status?: CardStatus; sprintId?: string }, now = new Date()): Promise<WorkCardDto[]> {
  const rows = await prisma.workCard.findMany({
    where: { ...(filter.status ? { status: filter.status } : VISIBLE), ...(filter.sprintId ? { sprintId: filter.sprintId } : {}) },
    orderBy: BY_POSITION,
    include: cardInclude(now),
  });
  return rows.map(toWorkCardDto);
}

/** POST /api/cards. Appended after the last card unless a position is given. */
export async function createCard(input: CreateCardInput, now = new Date()): Promise<WorkCardDto> {
  const row = await prisma.$transaction(async (tx) => {
    if (input.sprintId) await assertSprintExists(tx, input.sprintId);
    const position = input.position ?? ((await tx.workCard.aggregate({ _max: { position: true } }))._max.position ?? 0) + POSITION_GAP;
    return tx.workCard.create({
      data: {
        title: input.title,
        repoFullName: input.repoFullName,
        milestoneTitle: input.milestoneTitle,
        sprintId: input.sprintId,
        position,
        createdBy: "user",
      },
    });
  });
  await publishLiveEvent({ type: "card.upserted", cardId: row.id });
  return loadCardDto(row.id, now);
}

function cardChanges(row: WorkCard, input: UpdateCardInput): { fields: string[]; data: Prisma.WorkCardUncheckedUpdateManyInput } {
  const fields: string[] = [];
  const data: Prisma.WorkCardUncheckedUpdateManyInput = {};
  const set = <K extends "title" | "status" | "sprintId" | "position" | "milestoneTitle">(field: K, value: WorkCard[K] | undefined) => {
    if (value === undefined || value === row[field]) return;
    fields.push(field);
    (data as Record<string, unknown>)[field] = value;
  };
  set("title", input.title);
  set("status", input.status);
  set("sprintId", input.sprintId);
  set("position", input.position);
  set("milestoneTitle", input.milestoneTitle);
  return { fields, data };
}

/** PATCH /api/cards/:id. Needs the version the page last read (D15); archiving is `status: "archived"`. */
export async function updateCard(id: string, input: UpdateCardInput, now = new Date()): Promise<WorkCardDto> {
  let changed: boolean;
  try {
    changed = await prisma.$transaction(async (tx) => {
      const row = await tx.workCard.findUnique({ where: { id } });
      if (!row) throw new HttpError("NOT_FOUND", `No card has id ${id}`);
      if (input.sprintId && input.sprintId !== row.sprintId) await assertSprintExists(tx, input.sprintId);

      const changes = cardChanges(row, input);
      // Nothing to change: answer with the current card, whatever version was sent.
      if (changes.fields.length === 0) return false;
      if (input.version !== row.version) throw new VersionConflict("stale_version", changes.fields, row.version, input.version);
      const updated = await tx.workCard.updateMany({ where: { id, version: row.version }, data: { ...changes.data, version: { increment: 1 } } });
      if (updated.count === 0) throw new VersionConflict("stale_version", changes.fields, row.version + 1, input.version);
      return true;
    });
  } catch (error) {
    if (!(error instanceof VersionConflict)) throw error;
    throw staleEditError("card", error, await loadCardDto(id, now));
  }

  if (changed) await publishLiveEvent({ type: "card.upserted", cardId: id });
  return loadCardDto(id, now);
}

/**
 * POST /api/cards/reorder. `ids` are cards that are not archived, in their new order; the
 * positions of every such card are rewritten (1000, 2000, …) in one transaction, unlisted cards
 * after the listed ones. Moved cards get a version bump. Returns the column in its new order.
 */
export async function reorderCards(ids: string[], now = new Date()): Promise<WorkCardDto[]> {
  const movedIds = await prisma.$transaction(async (tx) => {
    const rows = await tx.workCard.findMany({ where: VISIBLE, orderBy: BY_POSITION, select: { id: true, position: true } });
    assertKnownIds(ids, rows, "a card on the Working-on list (it may be archived or deleted; reload)");
    const { updates } = planReorder(rows, ids, POSITION_GAP);
    for (const update of updates) {
      await tx.workCard.update({ where: { id: update.id }, data: { position: update.position, version: { increment: 1 } } });
    }
    return updates.map((update) => update.id);
  });

  for (const cardId of movedIds) await publishLiveEvent({ type: "card.upserted", cardId });
  return listCards({}, now);
}
