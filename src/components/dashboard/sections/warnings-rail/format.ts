import { formatClock, localDateString } from "@/lib/time/zone";
import type { AlertDto, SeerrDecisionResponse, SeerrRequestDto, TodayResponse, WaitingDto } from "@/types/dashboard-contracts";
import { isApiRequestError } from "../../api";

// Pure text and state helpers for the Warnings rail (no React), so they can be unit-tested.

/** "1 movie", "3 movies". */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Gmail item: "1 starred thread needs a reply" / "3 starred threads need a reply". */
export function gmailLine(count: number): string {
  return count === 1 ? "1 starred thread needs a reply" : `${count} starred threads need a reply`;
}

/** Seerr card: the count is "?" while Seerr can't be asked. */
export function seerrSummary(count: number | null): string {
  if (count === 0) return "No requests waiting";
  if (count === null) return "? guest requests to approve";
  return `${countLabel(count, "guest request", "guest requests")} to approve`;
}

/** "season 1", "seasons 1–3", "seasons 1–2, 5"; Seerr's season 0 is Specials. Null for movies / no seasons. */
export function seasonsLabel(seasons: readonly number[] | null): string | null {
  if (!seasons || seasons.length === 0) return null;
  const sorted = [...new Set(seasons)].sort((a, b) => a - b);
  const specials = sorted[0] === 0;
  const numbered = specials ? sorted.slice(1) : sorted;
  const ranges: string[] = [];
  for (let i = 0; i < numbered.length; ) {
    let j = i;
    while (j + 1 < numbered.length && numbered[j + 1] === numbered[j] + 1) j += 1;
    ranges.push(i === j ? `${numbered[i]}` : `${numbered[i]}–${numbered[j]}`);
    i = j + 1;
  }
  const parts: string[] = [];
  if (specials) parts.push("specials");
  if (numbered.length > 0) parts.push(`${numbered.length === 1 ? "season" : "seasons"} ${ranges.join(", ")}`);
  return parts.join(" + ");
}

/** "The Matrix (1999)". */
export function requestTitle(request: Pick<SeerrRequestDto, "title" | "year">): string {
  return request.year === null ? request.title : `${request.title} (${request.year})`;
}

/** "Movie · requested by maria", "TV · seasons 1–2 · requested by luis". */
export function requestMeta(request: Pick<SeerrRequestDto, "mediaType" | "seasons" | "requestedBy">): string {
  const seasons = request.mediaType === "tv" ? seasonsLabel(request.seasons) : null;
  return [request.mediaType === "movie" ? "Movie" : "TV", seasons, `requested by ${request.requestedBy}`].filter(Boolean).join(" · ");
}

// ---------- Seerr decisions ----------

export type SeerrLibrary = SeerrDecisionResponse["library"];

/** What happened to a row in this bubble. Handled rows stay listed (greyed) until the bubble closes. */
export type SeerrOutcome =
  | { kind: "approved"; library: SeerrLibrary }
  | { kind: "declined" }
  /** 409: approved or declined in Seerr itself (or by another tab) before this click landed. */
  | { kind: "elsewhere" }
  /** 404: the request no longer exists in Seerr. */
  | { kind: "gone" };

const LIBRARY_LABEL: Record<SeerrLibrary, string> = {
  temp: "Temp library",
  permanent: "Permanent library",
  anime: "Anime library",
};

export function outcomeText(outcome: SeerrOutcome): string {
  switch (outcome.kind) {
    case "approved":
      return `Approved → ${LIBRARY_LABEL[outcome.library]}`;
    case "declined":
      return "Declined";
    case "elsewhere":
      return "Already handled in Seerr";
    case "gone":
      return "No longer in Seerr";
  }
}

export const SEERR_RETRY_TEXT = "Seerr didn't answer — try again.";

/**
 * A failed approve/decline: either the row is settled anyway (409 → handled elsewhere, 404 → gone;
 * the list is reloaded) or it stays active with a one-line reason.
 */
export function decisionFailure(error: unknown): { settled: SeerrOutcome } | { retry: string } {
  if (isApiRequestError(error, "CONFLICT")) return { settled: { kind: "elsewhere" } };
  if (isApiRequestError(error, "NOT_FOUND")) return { settled: { kind: "gone" } };
  return { retry: requestErrorText(error) };
}

/** One line for a failed /api/seerr/* call. Server messages are written for the page and never carry the API key. */
export function requestErrorText(error: unknown): string {
  if (isApiRequestError(error, "SEERR_UNAVAILABLE")) return SEERR_RETRY_TEXT;
  if (isApiRequestError(error, "NETWORK_ERROR")) return "Can't reach the dashboard server — try again.";
  if (isApiRequestError(error)) return error.message;
  return "Something went wrong — try again.";
}

/**
 * Optimistic count while a decision is in flight: sets (never decrements) the Waiting count to at
 * most `target`, so re-applying it on every refresh, or after the server already counted the
 * change, never drops it twice. A null count (Seerr down) is left alone.
 */
export function withSeerrPendingAtMost(today: TodayResponse, target: number): TodayResponse {
  const current = today.warnings.waiting.seerrPending;
  if (current === null || current <= target) return today;
  return {
    ...today,
    warnings: { ...today.warnings, waiting: { ...today.warnings.waiting, seerrPending: target } },
  };
}

// ---------- The bubble's list ----------

/** GET /api/seerr/requests lists at most this many (PENDING_TAKE in src/lib/integrations/seerr/pending.ts). */
export const SEERR_LIST_CAP = 20;

export interface SeerrListState {
  /** "loading" only until the first answer; reloads keep showing the current rows. */
  phase: "loading" | "ready";
  rows: SeerrRequestDto[];
  outcomes: Record<number, SeerrOutcome>;
  /** Why the last load failed; cleared by the next good one. */
  error: string | null;
}

export type SeerrListAction =
  | { type: "loaded"; requests: SeerrRequestDto[] }
  | { type: "failed"; message: string }
  | { type: "handled"; id: number; outcome: SeerrOutcome };

export const initialSeerrList: SeerrListState = { phase: "loading", rows: [], outcomes: {}, error: null };

/**
 * Fresh pending list merged with what is on screen: handled rows stay where they were (Seerr no
 * longer lists them), rows still pending keep their place with fresh data, rows gone from Seerr
 * without a click here drop out, and new requests go on top (Seerr lists newest first).
 */
export function mergeRequestRows(
  previous: readonly SeerrRequestDto[],
  fresh: readonly SeerrRequestDto[],
  outcomes: Readonly<Record<number, SeerrOutcome>>,
): SeerrRequestDto[] {
  const freshById = new Map(fresh.map((request) => [request.id, request]));
  const known = new Set(previous.map((request) => request.id));
  const added = fresh.filter((request) => !known.has(request.id));
  const kept = previous.flatMap((request) => {
    const update = freshById.get(request.id);
    if (update) return [update];
    return outcomes[request.id] ? [request] : [];
  });
  return [...added, ...kept];
}

export function seerrListReducer(state: SeerrListState, action: SeerrListAction): SeerrListState {
  switch (action.type) {
    case "loaded":
      return { ...state, phase: "ready", rows: mergeRequestRows(state.rows, action.requests, state.outcomes), error: null };
    case "failed":
      return { ...state, phase: "ready", error: action.message };
    case "handled":
      return { ...state, outcomes: { ...state.outcomes, [action.id]: action.outcome } };
  }
}

/**
 * "+ 5 more in Seerr" when the list hit its cap and Seerr has more than it shows. Below the cap a
 * count that differs from the list is just a refresh in flight, not hidden requests.
 */
export function moreInSeerr(count: number | null, pendingShown: number): number | null {
  if (count === null || pendingShown < SEERR_LIST_CAP || count <= pendingShown) return null;
  return count - pendingShown;
}

// ---------- Panels ----------

export interface WaitingVisibility {
  gmail: boolean;
  seerr: boolean;
  orphans: boolean;
  /** "Nothing waiting." */
  nothing: boolean;
}

/**
 * Each item hides at zero. Seerr stays while Seerr is down (count "?") and while its bubble is
 * open, so approving the last request doesn't yank the bubble away.
 */
export function waitingVisibility(waiting: WaitingDto, seerrOk: boolean, seerrOpen: boolean): WaitingVisibility {
  const gmail = waiting.gmailNeedsReply > 0;
  const seerr = seerrOpen || !seerrOk || waiting.seerrPending === null || waiting.seerrPending > 0;
  const orphans = waiting.orphans.sonarr > 0 || waiting.orphans.radarr > 0;
  return { gmail, seerr, orphans, nothing: !gmail && !seerr && !orphans };
}

/** Booked block tag: "19:00–20:30" today, "Oct 15 · 19:00–20:30" on another day. */
export function blockTag(scheduled: NonNullable<AlertDto["scheduled"]>, timeZone: string, now: Date): string {
  const start = new Date(scheduled.startsAt);
  const range = `${formatClock(start, timeZone)}–${formatClock(new Date(scheduled.endsAt), timeZone)}`;
  if (localDateString(start, timeZone) === localDateString(now, timeZone)) return range;
  const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(start);
  return `${day} · ${range}`;
}
