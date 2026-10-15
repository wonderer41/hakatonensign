import { buildTimeline, NOW_MARKER_ID, type TimelineSourceEvent } from "@/lib/timeline/build";
import { formatClock, localDateString } from "@/lib/time/zone";
import type { GapTone, TimelineEventDto, TimelineResponse } from "@/types/dashboard-contracts";

/** How the shown day relates to the current local day. */
export type DayRelation = "past" | "today" | "future";

/** past = ended before now (dimmed, "done"); current = running now; future = not started. */
export type CardState = "past" | "current" | "future";

/** The square on the line: hollow lilac (now), filled lilac (Hermes), filled gray (done), hollow light (upcoming). */
export type MarkerStyle = "now" | "work-block" | "past" | "future";

export interface GapView {
  minutes: number;
  tone: GapTone;
  /** "36m", "1h 21m", "2h" or "overlap". */
  label: string;
  /** Screen-reader wording: "36m free before the next item" / "overlaps the next event". */
  description: string;
}

export interface EventCardView {
  type: "event";
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** "13:00" and "14:15" in the dashboard zone. */
  start: string;
  end: string;
  /** "calendar", "via hermes", "done" or "via hermes · done". */
  source: string;
  state: CardState;
  workBlock: boolean;
  marker: MarkerStyle;
  /** Free time from this item to the next one; null for the last item or when there is nothing to measure. */
  gap: GapView | null;
}

export interface NowCardView {
  type: "now";
  id: typeof NOW_MARKER_ID;
  at: string;
  /** "11:45" in the dashboard zone. */
  time: string;
  marker: "now";
  gap: GapView | null;
}

export type TrackItem = EventCardView | NowCardView;

export interface AllDayView {
  id: string;
  title: string;
  state: CardState;
}

export interface TimelineView {
  relation: DayRelation;
  allDay: AllDayView[];
  /** Timed cards in order, with the now marker spliced in on today's date. */
  items: TrackItem[];
  /** Timed + all-day events (the now marker is not an event). */
  eventCount: number;
}

/** Past, today or future, comparing local calendar dates in the dashboard zone. */
export function dayRelation(date: string, now: Date, timeZone: string): DayRelation {
  const today = localDateString(now, timeZone);
  if (date < today) return "past";
  if (date > today) return "future";
  return "today";
}

/**
 * Today the clock decides (ended → past, started → current, else future). Another day is never dimmed
 * by the clock: a past day is all done, a future day is all upcoming.
 */
export function cardState(event: Pick<TimelineEventDto, "startsAt" | "endsAt">, nowMs: number, relation: DayRelation): CardState {
  if (relation === "past") return "past";
  if (relation === "future") return "future";
  if (Date.parse(event.endsAt) <= nowMs) return "past";
  if (Date.parse(event.startsAt) <= nowMs) return "current";
  return "future";
}

/** The source word on a card. A Hermes block that is over keeps "via hermes" and adds "done". */
export function sourceWord(kind: TimelineEventDto["kind"], state: CardState): string {
  if (kind === "work_block") return state === "past" ? "via hermes · done" : "via hermes";
  return state === "past" ? "done" : "calendar";
}

export function markerStyle(kind: TimelineEventDto["kind"], state: CardState): MarkerStyle {
  if (kind === "work_block") return "work-block";
  return state === "past" ? "past" : "future";
}

/** "36m", "1h 21m", "2h"; negative minutes read "overlap". */
export function formatGap(minutes: number): string {
  if (minutes < 0) return "overlap";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function describeGap(minutes: number): string {
  return minutes < 0 ? "overlaps the next item" : `${formatGap(minutes)} free before the next item`;
}

/**
 * Where the now marker goes among timed events sorted by start: before the first event that starts at
 * or after now (on a tie the marker goes first, like the mockup and lib/timeline/build.ts).
 */
export function nowMarkerIndex(events: readonly Pick<TimelineEventDto, "startsAt">[], nowMs: number): number {
  const index = events.findIndex((event) => Date.parse(event.startsAt) >= nowMs);
  return index === -1 ? events.length : index;
}

function toSource(event: TimelineEventDto): TimelineSourceEvent {
  return {
    id: event.id,
    title: event.title,
    startsAt: new Date(event.startsAt),
    endsAt: new Date(event.endsAt),
    allDay: event.allDay,
    kind: event.kind,
    checklistItemId: event.checklistItemId,
    alertId: event.alertId,
    htmlLink: event.htmlLink,
  };
}

/**
 * Everything the section draws, from the server's timeline and the page's minute clock. Gaps and
 * states are recomputed for `now` (the server measured them at its own time), with the same rules as
 * lib/timeline/build.ts: the now marker counts as a card on today's date, gaps run from the latest
 * end so far, negative = overlap.
 */
export function buildTimelineView(timeline: TimelineResponse, now: string, date: string, timeZone: string): TimelineView {
  const nowDate = new Date(now);
  const nowMs = nowDate.getTime();
  const relation = dayRelation(date, nowDate, timeZone);

  const rebuilt = buildTimeline({
    date,
    timeZone,
    now: nowDate,
    events: timeline.events.map(toSource),
    lastSyncAt: null,
    syncError: null,
  });
  const gapAfter = new Map(rebuilt.gaps.map((gap) => [gap.afterEventId, gap]));
  const gapView = (id: string): GapView | null => {
    const gap = gapAfter.get(id);
    if (!gap) return null;
    return { minutes: gap.minutes, tone: gap.tone, label: formatGap(gap.minutes), description: describeGap(gap.minutes) };
  };

  const items: TrackItem[] = rebuilt.events.map((event) => {
    const state = cardState(event, nowMs, relation);
    return {
      type: "event",
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      start: formatClock(new Date(event.startsAt), timeZone),
      end: formatClock(new Date(event.endsAt), timeZone),
      source: sourceWord(event.kind, state),
      state,
      workBlock: event.kind === "work_block",
      marker: markerStyle(event.kind, state),
      gap: gapView(event.id),
    };
  });

  if (relation === "today") {
    items.splice(nowMarkerIndex(rebuilt.events, nowMs), 0, {
      type: "now",
      id: NOW_MARKER_ID,
      at: now,
      time: formatClock(nowDate, timeZone),
      marker: "now",
      gap: gapView(NOW_MARKER_ID),
    });
  }

  // The last item has nothing after it (build.ts never emits a gap there; this keeps it explicit).
  const last = items[items.length - 1];
  if (last) last.gap = null;

  const allDay = timeline.allDay.map((event) => ({ id: event.id, title: event.title, state: cardState(event, nowMs, relation) }));

  return { relation, allDay, items, eventCount: timeline.events.length + timeline.allDay.length };
}
