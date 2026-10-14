import { addDays, localDateString, zonedTimeToUtc } from "@/lib/time/zone";

/** Exponential backoff for reconnects and failed refreshes: 1 s, 2 s, 4 s … capped at 30 s. */
export function backoffDelay(attempt: number, baseMs = 1_000, maxMs = 30_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}

/** Milliseconds until the next whole minute (minute boundaries are the same in every modern zone). */
export function msUntilNextMinute(nowMs: number): number {
  return 60_000 - (((nowMs % 60_000) + 60_000) % 60_000);
}

/** Milliseconds until the next local midnight in `timeZone` (DST days are 23 or 25 hours long). */
export function msUntilNextLocalMidnight(nowMs: number, timeZone: string): number {
  const today = localDateString(new Date(nowMs), timeZone);
  return zonedTimeToUtc(addDays(today, 1), 0, timeZone).getTime() - nowMs;
}

/** Injectable clock and timers, so the feed and the live connection can be tested without waiting. */
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export const realTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  now: () => Date.now(),
};
