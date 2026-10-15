import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChecklistItemDto, ItemProgressDto, TodayResponse, WorkCardDto } from "@/types/dashboard-contracts";
import { confirmProgress, currentOf, dropProgress, setItemDone } from "./optimistic";

const AT = "2026-10-14T18:00:00.000Z";

function note(id: string, kind: ItemProgressDto["kind"]): ItemProgressDto {
  return {
    id,
    kind,
    status: "pending",
    note: "n",
    repoFullName: "o/r",
    commitSha: "abcdef1234",
    commitUrl: "https://github.com/o/r/commit/abcdef1234",
    pushedAt: AT,
  };
}

function item(id: string, done: boolean, extra: Partial<ChecklistItemDto> = {}): ChecklistItemDto {
  return {
    id,
    cardId: "c1",
    externalKey: null,
    title: id,
    issueNumber: null,
    sourceUrl: null,
    done,
    doneAt: done ? AT : null,
    isCurrent: false,
    position: 0,
    createdBy: "user",
    version: 1,
    scheduled: null,
    progress: [],
    ...extra,
  };
}

function page(items: ChecklistItemDto[]): TodayResponse {
  const card: WorkCardDto = {
    id: "c1",
    externalKey: null,
    title: "card",
    repoFullName: null,
    milestoneTitle: null,
    sprintId: null,
    status: "active",
    position: 1000,
    createdBy: "user",
    metaLine: null,
    progress: { done: items.filter((i) => i.done).length, total: items.length },
    current: currentOf(items),
    hermesSuggestion: null,
    items,
    version: 1,
    updatedAt: AT,
  };
  const other: WorkCardDto = { ...card, id: "c2", items: [item("x", false)], progress: { done: 0, total: 1 } };
  return { workingOn: { activeSprint: null, cards: [card, other] } } as unknown as TodayResponse;
}

const cardOf = (today: TodayResponse) => today.workingOn.cards[0];

test("current item: isCurrent and open wins, else the first open one", () => {
  assert.deepEqual(currentOf([item("a", true), item("b", false), item("c", false, { isCurrent: true })]), { itemId: "c", label: "now" });
  assert.deepEqual(currentOf([item("a", true), item("b", false), item("c", true, { isCurrent: true })]), { itemId: "b", label: "next" });
  assert.equal(currentOf([item("a", true)]), null);
});

test("checking an item updates progress and the current item, and hides its push notes", () => {
  const before = page([item("a", true), item("b", false, { isCurrent: true, progress: [note("p1", "partial")] }), item("c", false)]);
  const after = setItemDone(before, "c1", "b", true, AT);
  const card = cardOf(after);
  assert.equal(card.items[1].done, true);
  assert.equal(card.items[1].doneAt, AT);
  assert.deepEqual(card.items[1].progress, []);
  assert.deepEqual(card.progress, { done: 2, total: 3 });
  assert.deepEqual(card.current, { itemId: "c", label: "next" });
  // Other cards are untouched (same object).
  assert.equal(after.workingOn.cards[1], before.workingOn.cards[1]);
});

test("setting is idempotent", () => {
  const before = page([item("a", false), item("b", false)]);
  const once = setItemDone(before, "c1", "a", true, AT);
  const twice = setItemDone(once, "c1", "a", true, AT);
  assert.deepEqual(twice, once);
  const unchecked = setItemDone(twice, "c1", "a", false, AT);
  assert.equal(cardOf(unchecked).items[0].done, false);
  assert.equal(cardOf(unchecked).items[0].doneAt, null);
  assert.deepEqual(cardOf(unchecked).progress, { done: 0, total: 2 });
});

test("dismiss drops only that note", () => {
  const before = page([item("a", false, { progress: [note("p1", "looks_done"), note("p2", "partial")] })]);
  const after = dropProgress(before, "c1", "a", "p1");
  assert.deepEqual(
    cardOf(after).items[0].progress.map((p) => p.id),
    ["p2"],
  );
  assert.equal(cardOf(after).items[0].done, false);
});

test("confirming looks_done checks the item; confirming partial just drops the note", () => {
  const before = page([item("a", false, { progress: [note("p1", "looks_done")] }), item("b", false, { progress: [note("p2", "partial")] })]);
  const done = confirmProgress(before, "c1", "a", "p1", AT);
  assert.equal(cardOf(done).items[0].done, true);
  assert.deepEqual(cardOf(done).progress, { done: 1, total: 2 });
  const partial = confirmProgress(before, "c1", "b", "p2", AT);
  assert.equal(cardOf(partial).items[1].done, false);
  assert.deepEqual(cardOf(partial).items[1].progress, []);
  // Applying the same update twice changes nothing more.
  assert.deepEqual(confirmProgress(done, "c1", "a", "p1", AT), done);
});
