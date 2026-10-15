import { fieldPath, invalid } from "@/lib/api/validate";

// Reordering: positions are integers with gaps of 1000 and a
// reorder rewrites them in one transaction. The page sends the ids in their new order; rows it
// did not list (e.g. a card Hermes added after the page loaded) keep their relative order after them.

export interface Positioned {
  id: string;
  position: number;
}

export interface PositionUpdate {
  id: string;
  position: number;
}

/**
 * Rejects an id that is not one of `rows` (400 with details.field "ids[i]"), so a stale list
 * from the page never moves a row of another card or an archived one.
 */
export function assertKnownIds(ids: readonly string[], rows: readonly Positioned[], what: string): void {
  const known = new Set(rows.map((row) => row.id));
  ids.forEach((id, index) => {
    if (!known.has(id)) invalid(fieldPath("ids", index), `is not ${what}`);
  });
}

/**
 * The new order and the writes that produce it. `rows` must be in their current order. The final
 * order is `ids` followed by the unlisted rows; positions become gap, 2·gap, …, and only rows whose
 * position actually changes are returned.
 */
export function planReorder(rows: readonly Positioned[], ids: readonly string[], gap: number): { order: string[]; updates: PositionUpdate[] } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const listed = ids.filter((id, index) => byId.has(id) && ids.indexOf(id) === index);
  const listedSet = new Set(listed);
  const order = [...listed, ...rows.map((row) => row.id).filter((id) => !listedSet.has(id))];
  const updates: PositionUpdate[] = [];
  order.forEach((id, index) => {
    const position = (index + 1) * gap;
    if (byId.get(id)?.position !== position) updates.push({ id, position });
  });
  return { order, updates };
}
