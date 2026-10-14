import { createContext, useContext, useEffect, useEffectEvent } from "react";
import type { LiveEvent, TodayResponse } from "@/types/dashboard-contracts";

/** Returns a changed copy of the page data. Must be pure and idempotent: set values, don't toggle. */
export type TodayUpdater = (today: TodayResponse) => TodayResponse;

export interface Mutate {
  /**
   * Local-only change, applied to the current data and overwritten by the next refresh.
   * Prefer the two-argument form for anything that writes to the server.
   */
  (update: TodayUpdater): void;
  /**
   * Optimistic write: `update` is shown at once and stays on top of every refresh until `request`
   * settles. On success the dashboard refetches and then drops the optimistic layer; on failure the
   * layer is dropped at once, the dashboard refetches, and the error is rethrown for you to show.
   */
  <T>(update: TodayUpdater, request: () => Promise<T>): Promise<T>;
}

export type LiveListener = (event: LiveEvent) => void;

export interface DashboardContextValue {
  /** The page data, with any optimistic changes applied. Read-only: change it through mutate(). */
  today: TodayResponse;
  /** The day the page shows (YYYY-MM-DD, dashboard zone). Leads today.date while a new day loads. */
  date: string;
  /** The URL named the date (?date=). A pinned page never rolls over at midnight. */
  pinned: boolean;
  /** `date` is the current local day. False for ?date= in the past or future. */
  isToday: boolean;
  /** A new day is loading (rollover); the timeline shows a skeleton until it lands. */
  loadingDate: boolean;
  /** ISO time, updated on every minute boundary. Use it for the now marker and past/future states. */
  now: string;
  /** IANA zone every date and clock on the page uses (DASHBOARD_TIME_ZONE). */
  timeZone: string;
  /** The live stream is down; the header shows "Reconnecting…". */
  reconnecting: boolean;
  /** The last refetch failed; the dashboard retries with backoff. */
  refreshFailed: boolean;
  /** Refetch /api/today soon (bursts are coalesced). Resolves when that refetch has settled; never rejects. */
  refresh: () => Promise<void>;
  mutate: Mutate;
  /** Low-level: prefer useLiveEvent(). Returns the unsubscribe function. */
  subscribe: (listener: LiveListener) => () => void;
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

/** Page state and actions. Only valid inside <Dashboard> (every section is). */
export function useDashboard(): DashboardContextValue {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard() must be used inside <Dashboard>");
  return value;
}

/**
 * Calls `listener` for every live event from /api/stream (after the dashboard has scheduled its own
 * refetch). Use it for data a section loads itself, e.g. the Seerr bubble reloading its list on
 * "seerr.changed". The listener always sees the latest props and state; no dependency array.
 */
export function useLiveEvent(listener: LiveListener): void {
  const { subscribe } = useDashboard();
  const onEvent = useEffectEvent(listener);
  useEffect(() => subscribe((event) => onEvent(event)), [subscribe]);
}
