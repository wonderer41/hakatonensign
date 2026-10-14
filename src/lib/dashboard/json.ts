import { isPlainObject } from "@/lib/api/validate";

/** JSON with object keys sorted, so two values compare equal regardless of key order (Postgres JSONB reorders keys). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

export function sameJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Shallow merge used for card and alert meta: keys in `patch` overwrite, a null value removes the key. */
export function mergeMeta(current: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = isPlainObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}
