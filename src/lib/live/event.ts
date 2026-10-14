import { isDateString } from "@/lib/time/zone";
import type { LiveEvent } from "@/types/dashboard-contracts";

/** Postgres rejects NOTIFY payloads of 8000 bytes or more. */
export const MAX_NOTIFY_PAYLOAD_BYTES = 7999;
const MAX_ID_LENGTH = 200;

// One entry per LiveEvent type: adding a type to the union without handling it here fails typecheck.
const LIVE_EVENT_TYPES: Record<LiveEvent["type"], true> = {
  "card.upserted": true,
  "card.removed": true,
  "item.upserted": true,
  "sprint.upserted": true,
  "timeline.changed": true,
  "banner.updated": true,
  "alert.changed": true,
  "schedule.updated": true,
  "seerr.changed": true,
  "day.rollover": true,
};

const BANNER_KINDS = new Set(["gmail", "orphans", "scan", "stocks", "dailyMessage"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && isDateString(value);
}

/**
 * Validates an unknown value against the LiveEvent union and returns a copy with only the
 * known fields, so nothing extra ever reaches the browser. Returns null when it doesn't fit.
 */
export function toLiveEvent(value: unknown): LiveEvent | null {
  if (!isRecord(value) || typeof value.type !== "string" || !Object.prototype.hasOwnProperty.call(LIVE_EVENT_TYPES, value.type)) return null;
  const type = value.type as LiveEvent["type"];
  switch (type) {
    case "card.upserted":
    case "card.removed":
      return isId(value.cardId) ? { type, cardId: value.cardId } : null;
    case "item.upserted":
      return isId(value.cardId) && isId(value.itemId) ? { type, cardId: value.cardId, itemId: value.itemId } : null;
    case "sprint.upserted":
      return isId(value.sprintId) ? { type, sprintId: value.sprintId } : null;
    case "timeline.changed":
    case "day.rollover":
      return isDate(value.date) ? { type, date: value.date } : null;
    case "banner.updated":
      return typeof value.kind === "string" && BANNER_KINDS.has(value.kind)
        ? { type, kind: value.kind as Extract<LiveEvent, { type: "banner.updated" }>["kind"] }
        : null;
    case "alert.changed":
      return isId(value.alertId) ? { type, alertId: value.alertId } : null;
    case "schedule.updated":
      return isId(value.scheduleId) ? { type, scheduleId: value.scheduleId } : null;
    case "seerr.changed":
      return { type };
  }
}

/** Parses a NOTIFY payload; malformed or unknown payloads give null and are ignored. */
export function parseLiveEventPayload(payload: string | undefined): LiveEvent | null {
  if (!payload) return null;
  try {
    return toLiveEvent(JSON.parse(payload));
  } catch {
    return null;
  }
}

/** The NOTIFY payload for an event. Throws if the event is invalid or too large to send. */
export function serializeLiveEvent(event: LiveEvent): string {
  const normalized = toLiveEvent(event);
  if (!normalized) throw new Error(`Invalid live event of type "${String((event as { type?: unknown }).type)}"`);
  const payload = JSON.stringify(normalized);
  if (Buffer.byteLength(payload, "utf8") > MAX_NOTIFY_PAYLOAD_BYTES) {
    throw new Error(`Live event "${normalized.type}" is larger than the ${MAX_NOTIFY_PAYLOAD_BYTES}-byte NOTIFY limit`);
  }
  return payload;
}
