import type { ItemProgress, Prisma } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { invalid } from "@/lib/api/validate";
import { prisma } from "@/lib/db/prisma";
import { describeRef, isUuid, refWhere, type RowRef } from "@/lib/hermes/keys";
import type { ProgressInput } from "@/lib/hermes/parse";
import { publishLiveEvent } from "@/lib/live/publish";
import type { ChecklistItemDto, HermesWriteResult, ItemProgressDto } from "@/types/dashboard-contracts";
import { retryOnUniqueViolation } from "./concurrency";
import { toItemProgressDto } from "./dto";
import { loadItemDto } from "./items";

// D7 push notes. Hermes reads each push, matches it to open checklist items and writes one note
// per (item, commit): looks_done ("looks done from push X — confirm?") or partial (progress).
// Hermes never checks an item; Gerardo confirms or dismisses each note on the page.
//
// Status rules:
// - A new note is pending.
// - Hermes re-sending the same (item, sha) with an identical payload changes nothing.
// - A different payload updates kind/note/pushedAt/repoFullName and keeps the status, except a
//   dismissed note whose kind changed goes back to pending (Hermes changed its verdict).
// - Confirm: pending → confirmed; for looks_done the item is also checked (done, doneAt, version +1).
// - Dismiss: pending → dismissed.
// - A note that is already confirmed or dismissed is final for the page: confirming or dismissing it
//   again returns 200 and changes nothing.

/** Fields to write when Hermes re-sends the note for the same (item, sha); null when identical. */
export function progressChanges(
  row: Pick<ItemProgress, "kind" | "note" | "pushedAt" | "repoFullName" | "status">,
  input: ProgressInput,
): Prisma.ItemProgressUpdateInput | null {
  const data: Prisma.ItemProgressUpdateInput = {};
  if (input.kind !== row.kind) data.kind = input.kind;
  if (input.note !== row.note) data.note = input.note;
  if (input.pushedAt !== row.pushedAt.toISOString()) data.pushedAt = new Date(input.pushedAt);
  if (input.repoFullName !== row.repoFullName) data.repoFullName = input.repoFullName;
  if (Object.keys(data).length === 0) return null;
  if (row.status === "dismissed" && data.kind !== undefined) {
    data.status = "pending";
    data.resolvedAt = null;
  }
  return data;
}

interface UpsertOutcome {
  row: ItemProgress;
  cardId: string;
  created: boolean;
  changed: boolean;
}

/** PUT /api/hermes/cards/:key/items/:itemKey/progress/:sha. The item must exist and be on that card. */
export async function upsertItemProgress(
  cardRef: RowRef,
  itemRef: RowRef,
  commitSha: string,
  input: ProgressInput,
): Promise<HermesWriteResult<ItemProgressDto>> {
  const outcome = await retryOnUniqueViolation(() =>
    prisma.$transaction(async (tx): Promise<UpsertOutcome> => {
      const card = await tx.workCard.findUnique({ where: refWhere(cardRef), select: { id: true } });
      if (!card) throw new HttpError("NOT_FOUND", `No card has ${describeRef(cardRef)}`);
      const item = await tx.checklistItem.findUnique({ where: refWhere(itemRef), select: { id: true, cardId: true } });
      if (!item) throw new HttpError("NOT_FOUND", `No item has ${describeRef(itemRef)}; create it first with PUT /api/hermes/cards/:key/items/:itemKey`);
      if (item.cardId !== card.id) throw new HttpError("NOT_FOUND", `The item with ${describeRef(itemRef)} is not on the card with ${describeRef(cardRef)}`);

      const existing = await tx.itemProgress.findUnique({
        where: { checklistItemId_commitSha: { checklistItemId: item.id, commitSha } },
      });
      if (!existing) {
        const row = await tx.itemProgress.create({
          data: {
            checklistItemId: item.id,
            commitSha,
            repoFullName: input.repoFullName,
            kind: input.kind,
            note: input.note,
            pushedAt: new Date(input.pushedAt),
            createdBy: "hermes",
          },
        });
        return { row, cardId: card.id, created: true, changed: true };
      }
      const data = progressChanges(existing, input);
      if (!data) return { row: existing, cardId: card.id, created: false, changed: false };
      const row = await tx.itemProgress.update({ where: { id: existing.id }, data });
      return { row, cardId: card.id, created: false, changed: true };
    }),
  );

  if (outcome.changed) await publishLiveEvent({ type: "item.upserted", cardId: outcome.cardId, itemId: outcome.row.checklistItemId });
  return { data: toItemProgressDto(outcome.row), created: outcome.created };
}

export type ProgressAction = "confirm" | "dismiss";

/** The :id and :progressId path segments of the browser routes. */
export function parseProgressParams(params: { id: string; progressId: string }): { itemId: string; progressId: string } {
  if (!isUuid(params.id)) invalid("id", "must be an item id (uuid)");
  if (!isUuid(params.progressId)) invalid("progressId", "must be a progress note id (uuid)");
  return { itemId: params.id.toLowerCase(), progressId: params.progressId.toLowerCase() };
}

/**
 * POST /api/items/:id/progress/:progressId/{confirm|dismiss} (browser, D3). One transaction;
 * returns the item as the page shows it afterwards.
 */
export async function resolveItemProgress(
  itemId: string,
  progressId: string,
  action: ProgressAction,
  now = new Date(),
): Promise<ChecklistItemDto> {
  const outcome = await prisma.$transaction(async (tx) => {
    const progress = await tx.itemProgress.findUnique({
      where: { id: progressId },
      select: { checklistItemId: true, kind: true, status: true, checklistItem: { select: { cardId: true } } },
    });
    if (!progress || progress.checklistItemId !== itemId) {
      throw new HttpError("NOT_FOUND", `Item ${itemId} has no push note ${progressId}`);
    }
    const cardId = progress.checklistItem.cardId;
    if (progress.status !== "pending") return { cardId, changed: false };

    const { count } = await tx.itemProgress.updateMany({
      where: { id: progressId, status: "pending" },
      data: { status: action === "confirm" ? "confirmed" : "dismissed", resolvedAt: now },
    });
    if (count === 0) return { cardId, changed: false };
    if (action === "confirm" && progress.kind === "looks_done") {
      // Checking an item that is already checked changes nothing (doneAt stays the first time).
      await tx.checklistItem.updateMany({
        where: { id: itemId, done: false },
        data: { done: true, doneAt: now, version: { increment: 1 } },
      });
    }
    return { cardId, changed: true };
  });

  if (outcome.changed) await publishLiveEvent({ type: "item.upserted", cardId: outcome.cardId, itemId });
  return loadItemDto(itemId, now);
}
