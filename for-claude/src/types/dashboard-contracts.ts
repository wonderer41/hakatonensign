// Homelab Daily — shared API contracts.
// Additive to src/types/contracts.ts. Import these types; do not redefine response shapes.
// All timestamps are ISO 8601 strings in UTC. All "date" fields are local dates (YYYY-MM-DD)
// in DASHBOARD_TIME_ZONE (default America/Denver).

export type Actor = "user" | "hermes" | "github" | "system";
export type SprintStatus = "planned" | "active" | "closed";
export type CardStatus = "active" | "paused" | "done" | "archived";
export type CalendarEventKind = "calendar" | "work_block";
export type ScheduleStatus = "checking" | "conflict" | "booked" | "failed" | "cancelled";
export type BannerKind = "gmail" | "orphans" | "scan" | "stocks";
export type AlertSeverity = "warning" | "critical";
export type GapTone = "short" | "medium" | "long" | "overlap"; // <30m, 30–60m, >60m, negative

// ---------- Sprints, cards, checklist ----------

export interface SprintDto {
  id: string;
  externalKey: string | null;
  name: string;
  goal: string | null;
  startsOn: string; // YYYY-MM-DD
  endsOn: string; // YYYY-MM-DD
  status: SprintStatus;
  daysLeft: number | null; // computed for active sprints
}

export interface ChecklistItemDto {
  id: string;
  cardId: string;
  externalKey: string | null;
  title: string;
  issueNumber: number | null;
  sourceUrl: string | null;
  done: boolean;
  doneAt: string | null;
  isCurrent: boolean;
  position: number;
  createdBy: Actor;
  version: number;
  /** Next upcoming work block for this item, if booked. */
  scheduled: { calendarEventId: string; startsAt: string; endsAt: string } | null;
}

export interface WorkCardDto {
  id: string;
  externalKey: string | null;
  title: string;
  repoFullName: string | null;
  milestoneTitle: string | null;
  sprintId: string | null;
  status: CardStatus;
  position: number;
  createdBy: Actor;
  /** Pre-formatted meta line, e.g. "last commit 10:31 · 6 this week". */
  metaLine: string | null;
  progress: { done: number; total: number };
  /** isCurrent item, or the first unchecked one; null when all done. */
  current: { itemId: string; label: "now" | "next" } | null;
  /** Hermes suggestion shown on the collapsed card (e.g. "Block 90 min tonight for #12?"). */
  hermesSuggestion: string | null;
  items: ChecklistItemDto[];
  version: number;
  updatedAt: string;
}

export interface CreateCardRequest {
  title: string;
  repoFullName?: string | null;
  milestoneTitle?: string | null;
  sprintId?: string | null;
  position?: number;
}

export interface UpdateCardRequest {
  version: number;
  title?: string;
  status?: CardStatus;
  sprintId?: string | null;
  position?: number;
  milestoneTitle?: string | null;
}

export interface CreateItemRequest {
  title: string;
  issueNumber?: number | null;
  sourceUrl?: string | null;
  position?: number;
}

export interface UpdateItemRequest {
  version: number;
  done?: boolean;
  title?: string;
  isCurrent?: boolean;
  position?: number;
}

export interface ReorderRequest {
  /** Full ordered list of ids; the server rewrites positions. */
  ids: string[];
}

// ---------- Timeline ----------

export interface TimelineEventDto {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  kind: CalendarEventKind;
  state: "past" | "current" | "future";
  checklistItemId: string | null;
  alertId: string | null;
  htmlLink: string | null;
}

export interface TimelineGapDto {
  afterEventId: string; // gap between this event (or "now") and the next one
  minutes: number; // negative = overlap
  tone: GapTone;
}

export interface TimelineResponse {
  date: string; // YYYY-MM-DD
  timeZone: string;
  now: string; // server time, for the "now" marker
  allDay: TimelineEventDto[];
  events: TimelineEventDto[]; // timed, sorted by startsAt
  gaps: TimelineGapDto[];
  lastSyncAt: string | null;
  syncError: string | null;
}

// ---------- Scheduling with Hermes ----------

export interface ScheduleRequestBody {
  /** Exactly one of checklistItemId / alertId. */
  checklistItemId?: string;
  alertId?: string;
  /** Local wall-clock start on the timeline's date, "HH:MM". */
  start: string;
  date: string; // YYYY-MM-DD
  durationMin: number; // 1–720
}

export interface ScheduleMessage {
  who: "hermes" | "me";
  text: string;
  at: string;
}

export interface ScheduleRequestDto {
  id: string;
  status: ScheduleStatus;
  checklistItemId: string | null;
  alertId: string | null;
  requestedStart: string;
  durationMin: number;
  conflict: { eventId: string; title: string; startsAt: string; endsAt: string } | null;
  suggestedStart: string | null;
  booked: { calendarEventId: string; startsAt: string; endsAt: string } | null;
  transcript: ScheduleMessage[];
  error: string | null;
}

// ---------- Banner snapshots (payloads pushed by Hermes / n8n) ----------

export interface GmailSnapshot {
  since: string; // ISO
  needsReply: { from: string; subject: string; threadUrl?: string | null }[];
  packages: { label: string; status: string }[]; // label = store or item
  payments: { merchant: string; at: string }[]; // no amounts, by design
  deletedCount: number;
}

export interface OrphansSnapshot {
  items: { name: string; kind: "episode" | "movie"; arr: "sonarr" | "radarr" }[];
  counts: { sonarr: number; radarr: number };
}

export interface ScanSnapshot {
  ranAt: string;
  up: number;
  total: number;
  issues: { container: string; summary: string }[];
}

export interface StocksSnapshot {
  asOf: string;
  rows: {
    symbol: string;
    price: number;
    currency: string;
    dayChangePct: number;
    sixMonthChangePct: number;
  }[];
}

export type BannerPayload =
  | { kind: "gmail"; payload: GmailSnapshot }
  | { kind: "orphans"; payload: OrphansSnapshot }
  | { kind: "scan"; payload: ScanSnapshot }
  | { kind: "stocks"; payload: StocksSnapshot };

export interface BannerDto {
  dailyMessage: { date: string; text: string; author: Actor } | null;
  gmail: { capturedAt: string; data: GmailSnapshot } | null;
  orphans: { capturedAt: string; data: OrphansSnapshot } | null;
  scan: { capturedAt: string; data: ScanSnapshot } | null;
  stocks: { capturedAt: string; data: StocksSnapshot } | null;
}

// ---------- Warnings ----------

export interface AlertDto {
  id: string;
  dedupeKey: string;
  source: string;
  title: string;
  detail: string | null;
  severity: AlertSeverity;
  openedAt: string;
  scheduled: { calendarEventId: string; startsAt: string; endsAt: string } | null;
}

export interface SeerrRequestDto {
  id: number;
  title: string;
  year: number | null;
  mediaType: "movie" | "tv";
  seasons: number[] | null;
  requestedBy: string;
  posterUrl: string | null;
  createdAt: string;
}

export interface SeerrDecisionRequest {
  library: "temp" | "permanent";
}

export interface WaitingDto {
  gmailNeedsReply: number;
  seerrPending: number;
  orphans: { sonarr: number; radarr: number; sonarrUrl: string | null; radarrUrl: string | null };
}

// ---------- Whole page ----------

export interface TodayResponse {
  date: string;
  timeZone: string;
  generatedAt: string;
  banner: BannerDto;
  timeline: TimelineResponse;
  workingOn: { activeSprint: SprintDto | null; cards: WorkCardDto[] };
  warnings: { alerts: AlertDto[]; waiting: WaitingDto };
}

// ---------- Live stream (/api/stream, Server-Sent Events) ----------

export type LiveEvent =
  | { type: "card.upserted"; cardId: string }
  | { type: "card.removed"; cardId: string }
  | { type: "item.upserted"; cardId: string; itemId: string }
  | { type: "sprint.upserted"; sprintId: string }
  | { type: "timeline.changed"; date: string }
  | { type: "banner.updated"; kind: BannerKind | "dailyMessage" }
  | { type: "alert.changed"; alertId: string }
  | { type: "schedule.updated"; scheduleId: string }
  | { type: "seerr.changed" }
  | { type: "day.rollover"; date: string };

// ---------- Hermes write API (/api/hermes/*, bearer HERMES_DASHBOARD_TOKEN) ----------

export interface HermesUpsertCard {
  title: string;
  repoFullName?: string | null;
  milestoneTitle?: string | null;
  sprintKey?: string | null;
  status?: CardStatus;
  position?: number;
  hermesSuggestion?: string | null;
  meta?: Record<string, unknown>;
  /** Override user-edited fields (see docs/03-DATA-MODEL.md, "Who wins"). */
  force?: boolean;
}

export interface HermesUpsertItem {
  title: string;
  issueNumber?: number | null;
  sourceUrl?: string | null;
  done?: boolean;
  isCurrent?: boolean;
  position?: number;
  force?: boolean;
}

export interface HermesUpsertSprint {
  name: string;
  goal?: string | null;
  startsOn: string;
  endsOn: string;
  status?: SprintStatus;
}

export interface HermesUpsertAlert {
  source: string;
  title: string;
  detail?: string | null;
  severity?: AlertSeverity;
  meta?: Record<string, unknown>;
}

export interface HermesWriteResult<T> {
  data: T;
  created: boolean;
}
