import type { ScheduleRequestDto } from "@/types/dashboard-contracts";
import type { ScheduleTarget } from "../schedule-bubble";
import { clockFromMinutes, clockFromServer, formatDuration, formatRange, wallMinutes } from "./format";
import { findFree, type BusyRange } from "./find-free";
import { MESSAGES } from "./validate";

/** "#13 Streak tracking", "Streak tracking" (no issue number) or "Fix · VM 100 backup missed". */
export function questionSubject(target: ScheduleTarget): string {
  if (target.kind === "alert") return `Fix · ${target.alert.title}`;
  const { issueNumber, title } = target.item;
  return issueNumber === null ? title : `#${issueNumber} ${title}`;
}

/** The short name Hermes uses once booked: "#13", or the title when there is no issue number. */
export function shortSubject(target: ScheduleTarget): string {
  if (target.kind === "alert") return `Fix · ${target.alert.title}`;
  const { issueNumber, title } = target.item;
  return issueNumber === null ? title : `#${issueNumber}`;
}

export function questionText(target: ScheduleTarget): string {
  return `When should I block time for ${questionSubject(target)}?`;
}

export type ReplyPhase = "checking" | "conflict" | "booked" | "failed";

export interface ReplyView {
  phase: ReplyPhase;
  /** Hermes's message; empty while checking (the bubble shows the "checking" line instead). */
  text: string;
  /** "HH:MM" for the one-click `Use HH:MM` button (conflicts only). */
  suggestion: string | null;
}

export interface ReplyContext {
  subject: string;
  date: string;
  timeZone: string;
  /** The page's busy ranges on `date`, used only when a conflict comes back without a suggestion. */
  busy?: readonly BusyRange[];
}

/** Turns the server's ScheduleRequestDto into what the bubble shows. */
export function replyFor(dto: ScheduleRequestDto, context: ReplyContext): ReplyView {
  const { timeZone, date } = context;
  switch (dto.status) {
    case "checking":
      return { phase: "checking", text: "", suggestion: null };
    case "booked": {
      const range = dto.booked
        ? formatRange(dto.booked.startsAt, dto.booked.endsAt, timeZone)
        : formatRange(dto.requestedStart, new Date(Date.parse(dto.requestedStart) + dto.durationMin * 60_000).toISOString(), timeZone);
      return { phase: "booked", text: `Done. ${context.subject} is on your calendar ${range}.`, suggestion: null };
    }
    case "conflict": {
      const length = formatDuration(dto.durationMin);
      let suggestion = dto.suggestedStart ? clockFromServer(dto.suggestedStart, timeZone) : null;
      if (!suggestion && context.busy) {
        // Count the conflicting event too, in case the page's copy of the calendar doesn't have it yet.
        const busy = dto.conflict
          ? [...context.busy, { start: wallMinutes(dto.conflict.startsAt, date, timeZone), end: wallMinutes(dto.conflict.endsAt, date, timeZone) }]
          : context.busy;
        const free = findFree(wallMinutes(dto.requestedStart, date, timeZone), dto.durationMin, busy);
        suggestion = free === null ? null : clockFromMinutes(free);
      }
      const what = dto.conflict
        ? `${dto.conflict.title} is on your calendar ${formatRange(dto.conflict.startsAt, dto.conflict.endsAt, timeZone)}.`
        : "something else is on your calendar then.";
      const next = suggestion ? ` The next free ${length} starts at ${suggestion}.` : ` There is no free ${length} left today.`;
      return { phase: "conflict", text: `I can't book that: ${what}${next}`, suggestion };
    }
    case "cancelled":
      return { phase: "failed", text: "That request was cancelled. Ask again when you're ready.", suggestion: null };
    case "failed":
    default:
      return { phase: "failed", text: dto.error?.trim() || MESSAGES.noAnswer, suggestion: null };
  }
}
