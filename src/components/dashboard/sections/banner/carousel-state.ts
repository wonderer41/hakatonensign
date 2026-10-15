/** Index of the selected slide, or 0 when it is gone (its data went away, or nothing is selected yet). */
export function resolveActiveIndex(ids: readonly string[], selected: string | null): number {
  const index = selected === null ? -1 : ids.indexOf(selected);
  return index === -1 ? 0 : index;
}

/** `index + delta`, wrapping around both ends. */
export function wrapIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** The id `delta` slides away from the selected one (wrapping); null when there are no slides. */
export function stepId<Id extends string>(ids: readonly Id[], selected: string | null, delta: number): Id | null {
  if (ids.length === 0) return null;
  return ids[wrapIndex(resolveActiveIndex(ids, selected), delta, ids.length)];
}
