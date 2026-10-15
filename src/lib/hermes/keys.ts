import { invalid } from "@/lib/api/validate";

// Stable keys Hermes (or a sync) chooses so repeated writes update instead of duplicating.
// Max 200 chars = the VarChar size.
// Cards, items and sprints Gerardo created on the page have no key; Hermes addresses those (and
// any other card, item or sprint) by id instead: "id:<uuid>", the id it read from GET /api/hermes/state.

export const KEY_MAX_LENGTH = 200;
export const ID_PREFIX = "id:";

const SLUG = "[a-z0-9][a-z0-9._-]*";
const OWNER = "[A-Za-z0-9][A-Za-z0-9-]*";
const REPO = "[A-Za-z0-9._-]+";
const NUMBER = "[1-9][0-9]{0,9}";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KeyKind = "card" | "item" | "sprint" | "alert";
/** Row kinds Hermes can address by id as well as by key. Alerts always have a dedupeKey. */
export type RefKind = Exclude<KeyKind, "alert">;

/** How a path segment (or a card's sprintKey) names a row: by its stable key, or by its id. */
export type RowRef = { kind: "key"; key: string } | { kind: "id"; id: string };

const FORMATS: Record<KeyKind, { patterns: RegExp[]; examples: string }> = {
  card: {
    patterns: [
      new RegExp(`^hermes:card:${SLUG}$`),
      new RegExp(`^github:milestone:${OWNER}/${REPO}:${NUMBER}$`),
      new RegExp(`^github:repo:${OWNER}/${REPO}$`),
    ],
    examples: "hermes:card:<slug>, github:milestone:<owner>/<repo>:<number> or github:repo:<owner>/<repo>",
  },
  item: {
    patterns: [new RegExp(`^hermes:item:${SLUG}:${SLUG}$`), new RegExp(`^github:issue:${OWNER}/${REPO}#${NUMBER}$`)],
    examples: "hermes:item:<card-slug>:<slug> or github:issue:<owner>/<repo>#<number>",
  },
  sprint: {
    // <slug> covers the documented hermes:sprint:<yyyy-mm-dd>.
    patterns: [new RegExp(`^hermes:sprint:${SLUG}$`), new RegExp(`^github:milestone:${OWNER}/${REPO}:${NUMBER}$`)],
    examples: "hermes:sprint:<yyyy-mm-dd> or github:milestone:<owner>/<repo>:<number>",
  },
  alert: {
    patterns: [/^[a-z0-9][a-z0-9_-]*(?::[A-Za-z0-9._/#@-]+)+$/],
    examples: "<source>:<thing>, e.g. container:jellyfin or proxmox:vzdump:vm100",
  },
};

/** Validates an already-decoded key. */
export function parseKey(value: unknown, kind: KeyKind, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(field, "is required");
  if (value.length > KEY_MAX_LENGTH) invalid(field, `must be at most ${KEY_MAX_LENGTH} characters`);
  if (!FORMATS[kind].patterns.some((pattern) => pattern.test(value))) {
    const alsoId = kind === "alert" ? "" : `, or ${ID_PREFIX}<uuid>`;
    invalid(field, `must look like ${FORMATS[kind].examples}${alsoId}`);
  }
  return value;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** A key, or "id:<uuid>" (already decoded). The uuid comes back lowercased. */
export function parseRef(value: unknown, kind: RefKind, field: string): RowRef {
  if (typeof value === "string" && value.startsWith(ID_PREFIX)) {
    const id = value.slice(ID_PREFIX.length);
    if (!isUuid(id)) invalid(field, `must be ${ID_PREFIX}<uuid>, using an id from GET /api/hermes/state`);
    return { kind: "id", id: id.toLowerCase() };
  }
  return { kind: "key", key: parseKey(value, kind, field) };
}

function decodeSegment(raw: string, field: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    invalid(field, "is not valid URL encoding");
  }
}

/**
 * Decodes a URL-encoded path segment (e.g. github%3Aissue%3Aowner%2Frepo%2313, or
 * id%3A<uuid>), then validates it as a key or an id reference.
 */
export function parseKeyParam(raw: string, kind: RefKind, field: string): RowRef {
  return parseRef(decodeSegment(raw, field), kind, field);
}

/** Alerts are addressed by dedupeKey only. */
export function parseDedupeKeyParam(raw: string, field: string): string {
  return parseKey(decodeSegment(raw, field), "alert", field);
}

/** Prisma unique filter for a ref; WorkCard, ChecklistItem and Sprint all have unique id and externalKey. */
export function refWhere(ref: RowRef): { id: string } | { externalKey: string } {
  return ref.kind === "id" ? { id: ref.id } : { externalKey: ref.key };
}

/** "key hermes:card:x" or "id 5f0c…", for error messages. */
export function describeRef(ref: RowRef): string {
  return ref.kind === "id" ? `id ${ref.id}` : `key ${ref.key}`;
}
