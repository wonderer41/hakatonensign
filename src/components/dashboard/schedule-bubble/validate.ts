import { clockFromMinutes, DAY_MINUTES, formatDuration, MAX_LENGTH, MIN_LENGTH, parseClock, parseLength } from "./format";

// Checks the bubble runs before asking the server.
// The texts are Hermes's replies, word for word from the spec and the mockup.

export const MESSAGES = {
  noStart: "I need a start time first.",
  badLength: "Give me a length of at least 1 minute.",
  tooLong: `Keep it to ${MAX_LENGTH} minutes (12 h) or less.`,
  pastDay: "That day is over. Pick a time today or later.",
  pastMidnight: "That runs past midnight. Try an earlier start.",
  noAnswer: "Hermes didn't answer. Try again.",
  notConnected: "Scheduling isn't connected yet — it arrives with the Hermes step.",
  checking: "Hermes is checking your calendar…",
} as const;

export function pastTimeMessage(nowClock: string): string {
  return `That time already passed today. Pick something after ${nowClock}.`;
}

/** Where the bubble's date sits relative to the current local day. */
export type DayState = "past" | "today" | "future";

export interface ScheduleDraft {
  /** The time input's value, "HH:MM" (empty when unset). */
  start: string;
  /** The length field's raw value, in minutes. */
  length: string;
}

export type DraftCheck =
  | { ok: true; start: string; startMin: number; durationMin: number }
  | { ok: false; field: "start" | "length"; message: string };

/**
 * Validates a draft in the mockup's order: start, length, past, midnight.
 * `nowMin` is the current local minute; it only matters when `day` is "today".
 */
export function checkDraft(draft: ScheduleDraft, day: DayState, nowMin: number): DraftCheck {
  const startMin = parseClock(draft.start);
  if (startMin === null) return { ok: false, field: "start", message: MESSAGES.noStart };
  const durationMin = parseLength(draft.length);
  if (durationMin === null || durationMin < MIN_LENGTH) return { ok: false, field: "length", message: MESSAGES.badLength };
  if (durationMin > MAX_LENGTH) return { ok: false, field: "length", message: MESSAGES.tooLong };
  if (day === "past") return { ok: false, field: "start", message: MESSAGES.pastDay };
  if (day === "today" && startMin < nowMin) return { ok: false, field: "start", message: pastTimeMessage(clockFromMinutes(nowMin)) };
  if (startMin + durationMin > DAY_MINUTES) return { ok: false, field: "start", message: MESSAGES.pastMidnight };
  return { ok: true, start: clockFromMinutes(startMin), startMin, durationMin };
}

/** What Gerardo's own message says (right-hand lilac bubble): "19:00–20:30 (1 h 30 min)". */
export function draftEcho(draft: ScheduleDraft): string {
  const startMin = parseClock(draft.start);
  if (startMin === null) return "No time set";
  const durationMin = parseLength(draft.length);
  if (durationMin === null || !(durationMin > 0)) return `${clockFromMinutes(startMin)}, no length`;
  return `${clockFromMinutes(startMin)}–${clockFromMinutes(startMin + durationMin)} (${formatDuration(durationMin)})`;
}

/**
 * The start the form opens with: an existing booking's start, else 19:00 (the mockup's default),
 * else — when 19:00 has already passed today — the next quarter hour.
 */
export function defaultStart(day: DayState, nowMin: number, bookedStartMin: number | null): string {
  if (bookedStartMin !== null && (day !== "today" || bookedStartMin >= nowMin)) return clockFromMinutes(bookedStartMin);
  const evening = 19 * 60;
  if (day !== "today" || nowMin <= evening) return clockFromMinutes(evening);
  return clockFromMinutes(Math.min(DAY_MINUTES - 15, Math.ceil((nowMin + 1) / 15) * 15));
}

/** The mockup's default length (90 min), or the existing booking's length when rescheduling. */
export function defaultLength(bookedMinutes: number | null): string {
  return String(bookedMinutes !== null && bookedMinutes >= MIN_LENGTH && bookedMinutes <= MAX_LENGTH ? bookedMinutes : 90);
}
