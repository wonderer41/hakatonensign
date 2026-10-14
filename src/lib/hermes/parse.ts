import {
  ROOT,
  boolean,
  enumValue,
  integer,
  invalid,
  jsonObject,
  localDate,
  optional,
  optionalHttpUrl,
  optionalString,
  requiredString,
  strictObject,
} from "@/lib/api/validate";
import type { AlertSeverity, CardStatus, SprintStatus } from "@/types/dashboard-contracts";
import { parseKey } from "./keys";

// Strict parsers for /api/hermes/* request bodies. Unknown fields are rejected by name.
// Convention for optional fields on an update: absent = keep the stored value, null = clear it.
// String limits match the @db.VarChar sizes in prisma/schema.prisma.

export const SPRINT_STATUSES: readonly SprintStatus[] = ["planned", "active", "closed"];
export const CARD_STATUSES: readonly CardStatus[] = ["active", "paused", "done", "archived"];
export const ALERT_SEVERITIES: readonly AlertSeverity[] = ["warning", "critical"];

const MAX_POSITION = 2_000_000_000; // Postgres INTEGER, with room for appends
const MAX_VERSION = 2_147_483_647;
const META_MAX_BYTES = 4096;
const REPO_FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

function version(value: unknown): number | undefined {
  return optional(value, (v) => integer(v, "version", { min: 1, max: MAX_VERSION }));
}

function force(value: unknown): boolean {
  return value === undefined ? false : boolean(value, "force");
}

function position(value: unknown): number | undefined {
  return optional(value, (v) => integer(v, "position", { min: 0, max: MAX_POSITION }));
}

function meta(value: unknown): Record<string, unknown> | undefined {
  return optional(value, (v) => jsonObject(v, "meta", META_MAX_BYTES));
}

export interface SprintInput {
  name: string;
  goal: string | null | undefined;
  startsOn: string;
  endsOn: string;
  status: SprintStatus | undefined;
  version: number | undefined;
  force: boolean;
}

export function parseUpsertSprint(body: unknown): SprintInput {
  const o = strictObject(body, ROOT, ["name", "goal", "startsOn", "endsOn", "status", "version", "force"]);
  const startsOn = localDate(o.startsOn, "startsOn");
  const endsOn = localDate(o.endsOn, "endsOn");
  if (endsOn < startsOn) invalid("endsOn", "must be on or after startsOn");
  return {
    name: requiredString(o.name, "name", 120),
    goal: optionalString(o.goal, "goal", 500),
    startsOn,
    endsOn,
    status: optional(o.status, (v) => enumValue(v, "status", SPRINT_STATUSES)),
    version: version(o.version),
    force: force(o.force),
  };
}

export interface CardInput {
  title: string;
  repoFullName: string | null | undefined;
  milestoneTitle: string | null | undefined;
  sprintKey: string | null | undefined;
  status: CardStatus | undefined;
  position: number | undefined;
  hermesSuggestion: string | null | undefined;
  meta: Record<string, unknown> | undefined;
  version: number | undefined;
  force: boolean;
}

export function parseUpsertCard(body: unknown): CardInput {
  const o = strictObject(body, ROOT, [
    "title",
    "repoFullName",
    "milestoneTitle",
    "sprintKey",
    "status",
    "position",
    "hermesSuggestion",
    "meta",
    "version",
    "force",
  ]);
  const repoFullName = optionalString(o.repoFullName, "repoFullName", 200);
  if (repoFullName && !REPO_FULL_NAME.test(repoFullName)) invalid("repoFullName", 'must look like "owner/repo"');
  return {
    title: requiredString(o.title, "title", 160),
    repoFullName,
    milestoneTitle: optionalString(o.milestoneTitle, "milestoneTitle", 160),
    sprintKey: o.sprintKey === undefined || o.sprintKey === null ? o.sprintKey : parseKey(o.sprintKey, "sprint", "sprintKey"),
    status: optional(o.status, (v) => enumValue(v, "status", CARD_STATUSES)),
    position: position(o.position),
    hermesSuggestion: optionalString(o.hermesSuggestion, "hermesSuggestion", 300),
    meta: meta(o.meta),
    version: version(o.version),
    force: force(o.force),
  };
}

export interface ItemInput {
  title: string;
  issueNumber: number | null | undefined;
  sourceUrl: string | null | undefined;
  done: boolean | undefined;
  isCurrent: boolean | undefined;
  position: number | undefined;
  version: number | undefined;
  force: boolean;
}

export function parseUpsertItem(body: unknown): ItemInput {
  const o = strictObject(body, ROOT, ["title", "issueNumber", "sourceUrl", "done", "isCurrent", "position", "version", "force"]);
  return {
    title: requiredString(o.title, "title", 200),
    issueNumber: o.issueNumber === null ? null : optional(o.issueNumber, (v) => integer(v, "issueNumber", { min: 1, max: MAX_VERSION })),
    sourceUrl: optionalHttpUrl(o.sourceUrl, "sourceUrl"),
    done: optional(o.done, (v) => boolean(v, "done")),
    isCurrent: optional(o.isCurrent, (v) => boolean(v, "isCurrent")),
    position: position(o.position),
    version: version(o.version),
    force: force(o.force),
  };
}

export interface AlertInput {
  source: string;
  title: string;
  detail: string | null | undefined;
  severity: AlertSeverity | undefined;
  meta: Record<string, unknown> | undefined;
}

export function parseUpsertAlert(body: unknown): AlertInput {
  const o = strictObject(body, ROOT, ["source", "title", "detail", "severity", "meta"]);
  return {
    source: requiredString(o.source, "source", 100),
    title: requiredString(o.title, "title", 200),
    detail: optionalString(o.detail, "detail", 500),
    severity: optional(o.severity, (v) => enumValue(v, "severity", ALERT_SEVERITIES)),
    meta: meta(o.meta),
  };
}

export function parseDailyMessage(body: unknown): { text: string } {
  const o = strictObject(body, ROOT, ["text"]);
  return { text: requiredString(o.text, "text", 500) };
}

export function parseCalendarChanged(body: unknown): { calendarId: string | undefined } {
  const o = strictObject(body ?? {}, ROOT, ["calendarId"]);
  return { calendarId: optionalString(o.calendarId, "calendarId", 200) ?? undefined };
}

/** POST routes that take no input accept no body, or an empty JSON object. */
export function parseNoInput(body: unknown): void {
  strictObject(body ?? {}, ROOT, []);
}

/** Like readJsonBody, but an empty body is allowed and returned as undefined. */
export async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    invalid(ROOT, "must be valid JSON");
  }
}
