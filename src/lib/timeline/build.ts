import type { CalendarEventKind } from "@/generated/prisma/client";
import { dayBounds } from "@/lib/time/zone";
import type { GapTone, TimelineEventDto, TimelineGapDto, TimelineResponse } from "@/types/dashboard-contracts";

/** The id gaps use for the "now" marker. */
export const NOW_MARKER_ID = "now";

export interface TimelineSourceEvent {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  kind: CalendarEventKind;
  checklistItemId: string | null;
  alertId: string | null;
  htmlLink: string | null;
}

export interface BuildTimelineInput {
  date: string;
  timeZone: string;
  now: Date;
  events: TimelineSourceEvent[];
  lastSyncAt: Date | null;
  syncError: string | null;
}

/** Free-time colors: under 30m green, 30–60m gold, over 60m pink. */
export function gapTone(minutes: number): GapTone {
  if (minutes < 0) return "overlap";
  if (minutes < 30) return "short";
  if (minutes <= 60) return "medium";
  return "long";
}

function toDto(event: TimelineSourceEvent, now: Date): TimelineEventDto {
  const state = event.endsAt <= now ? "past" : event.startsAt <= now ? "current" : "future";
  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    allDay: event.allDay,
    kind: event.kind,
    state,
    checklistItemId: event.checklistItemId,
    alertId: event.alertId,
    htmlLink: event.htmlLink,
  };
}

function byStart(a: TimelineSourceEvent, b: TimelineSourceEvent): number {
  return a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime() || a.title.localeCompare(b.title);
}

/**
 * One local day of the timeline. Gaps run between neighbouring cards (the "now" marker counts as a card
 * on today's date) and are measured from the latest end so far, so a long event that swallows shorter
 * ones still yields the right free time after it.
 */
export function buildTimeline(input: BuildTimelineInput): TimelineResponse {
  const { start: dayStart, end: dayEnd } = dayBounds(input.date, input.timeZone);
  const inDay = input.events.filter((event) => event.startsAt < dayEnd && event.endsAt > dayStart);
  const allDay = inDay.filter((event) => event.allDay).sort(byStart);
  const timed = inDay.filter((event) => !event.allDay).sort(byStart);

  const nowMs = input.now.getTime();
  const showNow = nowMs >= dayStart.getTime() && nowMs < dayEnd.getTime();
  const cards: { id: string; start: number; end: number }[] = timed.map((event) => ({
    id: event.id,
    start: event.startsAt.getTime(),
    end: event.endsAt.getTime(),
  }));
  if (showNow) {
    // On a tie the marker goes first, like the mockup.
    const index = cards.findIndex((card) => card.start >= nowMs);
    cards.splice(index === -1 ? cards.length : index, 0, { id: NOW_MARKER_ID, start: nowMs, end: nowMs });
  }

  const gaps: TimelineGapDto[] = [];
  let latestEnd = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    if (i > 0) {
      const insideEvent = card.id === NOW_MARKER_ID && card.start < latestEnd;
      if (!insideEvent) {
        const minutes = Math.round((card.start - latestEnd) / 60_000);
        gaps.push({ afterEventId: cards[i - 1].id, minutes, tone: gapTone(minutes) });
      }
    }
    latestEnd = Math.max(latestEnd, card.end);
  }

  return {
    date: input.date,
    timeZone: input.timeZone,
    now: input.now.toISOString(),
    allDay: allDay.map((event) => toDto(event, input.now)),
    events: timed.map((event) => toDto(event, input.now)),
    gaps,
    lastSyncAt: input.lastSyncAt ? input.lastSyncAt.toISOString() : null,
    syncError: input.syncError,
  };
}
