import {
  ROOT,
  arrayOf,
  boolean,
  enumValue,
  fieldPath,
  integer,
  invalid,
  localDate,
  optional,
  optionalHttpUrl,
  optionalString,
  requiredString,
  strictObject,
} from "@/lib/api/validate";
import { CARD_STATUSES, SPRINT_STATUSES } from "@/lib/hermes/parse";
import type { CardStatus, SprintStatus } from "@/types/dashboard-contracts";

// Strict parsers for the browser routes. Same rules as
// the Hermes parsers: unknown fields are rejected by name (400 with details.field), string
// limits match the @db.VarChar sizes, and on an update absent = keep, null = clear.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POSITION = 2_000_000_000; // Postgres INTEGER, with room for appends
const MAX_VERSION = 2_147_483_647;
const MAX_ISSUE_NUMBER = 2_147_483_647;
/** A reorder sends the whole visible list; far more than one page will ever show. */
const MAX_REORDER_IDS = 500;
const REPO_FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

/** A row id (Postgres uuid), returned lowercased. */
export function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid(field, "must be a UUID");
  return value.toLowerCase();
}

function version(value: unknown): number {
  if (value === undefined) invalid("version", "is required: send the version you last read");
  return integer(value, "version", { min: 1, max: MAX_VERSION });
}

function position(value: unknown): number | undefined {
  return optional(value, (v) => integer(v, "position", { min: 0, max: MAX_POSITION }));
}

function optionalUuid(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  return uuid(value, field);
}

// ---------- Sprints ----------

/** A sprint created on the page starts as planned unless it is created active (D8). */
export const CREATE_SPRINT_STATUSES: readonly SprintStatus[] = ["planned", "active"];

export interface CreateSprintInput {
  name: string;
  goal: string | null;
  startsOn: string;
  endsOn: string;
  status: SprintStatus;
}

export function parseCreateSprint(body: unknown): CreateSprintInput {
  const o = strictObject(body, ROOT, ["name", "goal", "startsOn", "endsOn", "status"]);
  const name = requiredString(o.name, "name", 120);
  const goal = optionalString(o.goal, "goal", 500) ?? null;
  const startsOn = localDate(o.startsOn, "startsOn");
  const endsOn = localDate(o.endsOn, "endsOn");
  if (endsOn < startsOn) invalid("endsOn", "must be on or after startsOn");
  return {
    name,
    goal,
    startsOn,
    endsOn,
    status: optional(o.status, (v) => enumValue(v, "status", CREATE_SPRINT_STATUSES)) ?? "planned",
  };
}

export interface UpdateSprintInput {
  version: number;
  name: string | undefined;
  goal: string | null | undefined;
  startsOn: string | undefined;
  endsOn: string | undefined;
  status: SprintStatus | undefined;
}

export function parseUpdateSprint(body: unknown): UpdateSprintInput {
  const o = strictObject(body, ROOT, ["version", "name", "goal", "startsOn", "endsOn", "status"]);
  return {
    version: version(o.version),
    name: optional(o.name, (v) => requiredString(v, "name", 120)),
    goal: optionalString(o.goal, "goal", 500),
    startsOn: optional(o.startsOn, (v) => localDate(v, "startsOn")),
    endsOn: optional(o.endsOn, (v) => localDate(v, "endsOn")),
    status: optional(o.status, (v) => enumValue(v, "status", SPRINT_STATUSES)),
  };
}

/** GET /api/sprints?status= (absent = every sprint). */
export function parseSprintQuery(params: URLSearchParams): { status: SprintStatus | undefined } {
  const status = params.get("status");
  return { status: status === null ? undefined : enumValue(status, "status", SPRINT_STATUSES) };
}

// ---------- Cards ----------

export interface CreateCardInput {
  title: string;
  repoFullName: string | null;
  milestoneTitle: string | null;
  sprintId: string | null;
  position: number | undefined;
}

function repoFullName(value: unknown): string | null | undefined {
  const repo = optionalString(value, "repoFullName", 200);
  if (repo && !REPO_FULL_NAME.test(repo)) invalid("repoFullName", 'must look like "owner/repo"');
  return repo;
}

export function parseCreateCard(body: unknown): CreateCardInput {
  const o = strictObject(body, ROOT, ["title", "repoFullName", "milestoneTitle", "sprintId", "position"]);
  return {
    title: requiredString(o.title, "title", 160),
    repoFullName: repoFullName(o.repoFullName) ?? null,
    milestoneTitle: optionalString(o.milestoneTitle, "milestoneTitle", 160) ?? null,
    sprintId: optionalUuid(o.sprintId, "sprintId") ?? null,
    position: position(o.position),
  };
}

export interface UpdateCardInput {
  version: number;
  title: string | undefined;
  status: CardStatus | undefined;
  sprintId: string | null | undefined;
  position: number | undefined;
  milestoneTitle: string | null | undefined;
}

export function parseUpdateCard(body: unknown): UpdateCardInput {
  const o = strictObject(body, ROOT, ["version", "title", "status", "sprintId", "position", "milestoneTitle"]);
  return {
    version: version(o.version),
    title: optional(o.title, (v) => requiredString(v, "title", 160)),
    status: optional(o.status, (v) => enumValue(v, "status", CARD_STATUSES)),
    sprintId: optionalUuid(o.sprintId, "sprintId"),
    position: position(o.position),
    milestoneTitle: optionalString(o.milestoneTitle, "milestoneTitle", 160),
  };
}

/** GET /api/cards?status=&sprintId= (no status = every card that is not archived). */
export function parseCardQuery(params: URLSearchParams): { status: CardStatus | undefined; sprintId: string | undefined } {
  const status = params.get("status");
  const sprintId = params.get("sprintId");
  return {
    status: status === null ? undefined : enumValue(status, "status", CARD_STATUSES),
    sprintId: sprintId === null ? undefined : uuid(sprintId, "sprintId"),
  };
}

// ---------- Checklist items ----------

export interface CreateItemInput {
  title: string;
  issueNumber: number | null;
  sourceUrl: string | null;
  position: number | undefined;
}

export function parseCreateItem(body: unknown): CreateItemInput {
  const o = strictObject(body, ROOT, ["title", "issueNumber", "sourceUrl", "position"]);
  return {
    title: requiredString(o.title, "title", 200),
    issueNumber: o.issueNumber === null ? null : (optional(o.issueNumber, (v) => integer(v, "issueNumber", { min: 1, max: MAX_ISSUE_NUMBER })) ?? null),
    sourceUrl: optionalHttpUrl(o.sourceUrl, "sourceUrl") ?? null,
    position: position(o.position),
  };
}

export interface UpdateItemInput {
  version: number;
  done: boolean | undefined;
  title: string | undefined;
  isCurrent: boolean | undefined;
  position: number | undefined;
}

export function parseUpdateItem(body: unknown): UpdateItemInput {
  const o = strictObject(body, ROOT, ["version", "done", "title", "isCurrent", "position"]);
  return {
    version: version(o.version),
    done: optional(o.done, (v) => boolean(v, "done")),
    title: optional(o.title, (v) => requiredString(v, "title", 200)),
    isCurrent: optional(o.isCurrent, (v) => boolean(v, "isCurrent")),
    position: position(o.position),
  };
}

// ---------- Reorder, daily message ----------

/** `{ ids }`: at least one id, no repeats. */
export function parseReorder(body: unknown): { ids: string[] } {
  const o = strictObject(body, ROOT, ["ids"]);
  const ids = arrayOf(o.ids, "ids", MAX_REORDER_IDS, (value, field) => uuid(value, field));
  if (ids.length === 0) invalid("ids", "must list at least one id");
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) invalid(fieldPath("ids", index), `repeats ${id}`);
    seen.add(id);
  });
  return { ids };
}

export function parseDailyMessageBody(body: unknown): { date: string; text: string } {
  const o = strictObject(body, ROOT, ["date", "text"]);
  return { date: localDate(o.date, "date"), text: requiredString(o.text, "text", 500) };
}
