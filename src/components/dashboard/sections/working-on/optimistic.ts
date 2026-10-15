import type { ChecklistItemDto, TodayResponse, WorkCardDto } from "@/types/dashboard-contracts";

// Pure updaters for mutate(update, request): they set values (never toggle), so applying one twice
// gives the same page. Card totals and the current item are recomputed the way the server does
// (src/lib/dashboard/dto.ts): items are already in position order.

/** The isCurrent item ("now") if it is still open, else the first unchecked one ("next"); null when all are done. */
export function currentOf(items: readonly ChecklistItemDto[]): WorkCardDto["current"] {
  const now = items.find((item) => item.isCurrent && !item.done);
  if (now) return { itemId: now.id, label: "now" };
  const next = items.find((item) => !item.done);
  return next ? { itemId: next.id, label: "next" } : null;
}

function withItems(card: WorkCardDto, items: ChecklistItemDto[]): WorkCardDto {
  return {
    ...card,
    items,
    progress: { done: items.filter((item) => item.done).length, total: items.length },
    current: currentOf(items),
  };
}

function updateItem(today: TodayResponse, cardId: string, itemId: string, change: (item: ChecklistItemDto) => ChecklistItemDto): TodayResponse {
  return {
    ...today,
    workingOn: {
      ...today.workingOn,
      cards: today.workingOn.cards.map((card) =>
        card.id === cardId ? withItems(card, card.items.map((item) => (item.id === itemId ? change(item) : item))) : card,
      ),
    },
  };
}

/**
 * The checkbox. A checked item shows no push notes (the server hides them too); unchecking keeps
 * whatever notes the item has until the next refresh brings the pending ones back.
 */
export function setItemDone(today: TodayResponse, cardId: string, itemId: string, done: boolean, at: string): TodayResponse {
  return updateItem(today, cardId, itemId, (item) =>
    item.done === done ? item : { ...item, done, doneAt: done ? at : null, progress: done ? [] : item.progress },
  );
}

/** Hides one push note (dismiss, or confirming a partial note). */
export function dropProgress(today: TodayResponse, cardId: string, itemId: string, progressId: string): TodayResponse {
  return updateItem(today, cardId, itemId, (item) => ({ ...item, progress: item.progress.filter((note) => note.id !== progressId) }));
}

/** Confirm (D7): a looks_done note also checks the item; a partial one just goes away. */
export function confirmProgress(today: TodayResponse, cardId: string, itemId: string, progressId: string, at: string): TodayResponse {
  const item = today.workingOn.cards.find((card) => card.id === cardId)?.items.find((entry) => entry.id === itemId);
  const note = item?.progress.find((entry) => entry.id === progressId);
  if (note?.kind === "looks_done") return setItemDone(today, cardId, itemId, true, at);
  return dropProgress(today, cardId, itemId, progressId);
}
