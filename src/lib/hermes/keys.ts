import { invalid } from "@/lib/api/validate";

// Stable keys Hermes (or a sync) chooses so repeated writes update instead of duplicating
// (for-claude/docs/03-DATA-MODEL.md, "Idempotent upserts"). Max 200 chars = the VarChar size.

export const KEY_MAX_LENGTH = 200;

const SLUG = "[a-z0-9][a-z0-9._-]*";
const OWNER = "[A-Za-z0-9][A-Za-z0-9-]*";
const REPO = "[A-Za-z0-9._-]+";
const NUMBER = "[1-9][0-9]{0,9}";

export type KeyKind = "card" | "item" | "sprint" | "alert";

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
    invalid(field, `must look like ${FORMATS[kind].examples}`);
  }
  return value;
}

/** Decodes a URL-encoded path segment (e.g. github%3Aissue%3Aowner%2Frepo%2313), then validates it. */
export function parseKeyParam(raw: string, kind: KeyKind, field: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    invalid(field, "is not valid URL encoding");
  }
  return parseKey(decoded, kind, field);
}
