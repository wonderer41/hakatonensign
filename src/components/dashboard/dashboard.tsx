"use client";

import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Header } from "@/components/header";
import { SkeletonPanel } from "@/components/ui/skeleton";
import { formatEyebrowDate, localDateString, zonedTimeToUtc } from "@/lib/time/zone";
import type { TodayResponse } from "@/types/dashboard-contracts";
import { fetchJson } from "./api";
import { DashboardContext, type DashboardContextValue, type LiveListener, type Mutate, type TodayUpdater } from "./context";
import { Banner } from "./sections/banner";
import { Timeline } from "./sections/timeline";
import { WarningsRail } from "./sections/warnings-rail";
import { WorkingOn } from "./sections/working-on";
import { msUntilNextLocalMidnight, msUntilNextMinute } from "./timing";
import { TodayFeed, type FeedView } from "./today-feed";
import { useLiveUpdates } from "./use-live-updates";

export interface DashboardProps {
  /** Built on the server for the first paint (no skeleton on load). */
  initial: TodayResponse;
  /** The URL named the date (?date=): the page stays on that day instead of rolling over at midnight. */
  pinned: boolean;
}

interface OptimisticLayer {
  id: number;
  update: TodayUpdater;
}

let layerSeq = 0;

/**
 * Owns all page state: the server data plus optimistic layers, the minute clock, the live stream
 * and the day shown. Sections get read-only slices as props and act through useDashboard().
 */
export function Dashboard({ initial, pinned }: DashboardProps) {
  const timeZone = initial.timeZone;
  const [server, setServer] = useState(initial);
  const [layers, setLayers] = useState<OptimisticLayer[]>([]);
  const [view, setView] = useState<FeedView>({ date: initial.date, pinned });
  const [now, setNow] = useState(initial.generatedAt);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const feedRef = useRef<TodayFeed | null>(null);
  const listenersRef = useRef(new Set<LiveListener>());
  // Server clock minus this browser's clock, so a fast laptop clock never rolls the page to a day
  // the server will immediately roll back.
  const serverOffsetRef = useRef(0);
  useEffect(() => {
    serverOffsetRef.current = Date.parse(initial.generatedAt) - Date.now();
  }, [initial.generatedAt]);

  useEffect(() => {
    const feed = new TodayFeed({
      view: { date: initial.date, pinned },
      load: (url, signal) => fetchJson<TodayResponse>(url, { signal }),
      onData: (today, nextView) => {
        setServer(today);
        setView(nextView);
        setRefreshFailed(false);
      },
      onError: (error, retryInMs) => {
        console.warn(`[dashboard] refresh failed, retrying in ${retryInMs / 1000} s:`, error);
        setRefreshFailed(true);
      },
    });
    feedRef.current = feed;
    return () => {
      feed.dispose();
      if (feedRef.current === feed) feedRef.current = null;
    };
  }, [initial.date, pinned]);

  const refresh = useCallback((): Promise<void> => feedRef.current?.request() ?? Promise.resolve(), []);

  /** Moves a page that follows today to `date` and loads it. Returns false when nothing changed. */
  const rollTo = useCallback((date: string): boolean => {
    const feed = feedRef.current;
    if (!feed) return false;
    const current = feed.currentView;
    if (current.pinned || current.date === date) return false;
    const next: FeedView = { date, pinned: false };
    setView(next);
    void feed.setView(next);
    return true;
  }, []);

  const mutateImpl = useCallback(
    (update: TodayUpdater, request?: () => Promise<unknown>) => {
      if (!request) {
        setServer((current) => update(current));
        return undefined;
      }
      layerSeq += 1;
      const id = layerSeq;
      setLayers((current) => [...current, { id, update }]);
      const drop = () => setLayers((current) => current.filter((layer) => layer.id !== id));
      return Promise.resolve()
        .then(request)
        .then(
          async (result) => {
            await refresh();
            drop();
            return result;
          },
          (error: unknown) => {
            drop();
            void refresh();
            throw error;
          },
        );
    },
    [refresh],
  );
  const mutate = mutateImpl as Mutate;

  const subscribe = useCallback((listener: LiveListener) => {
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const { reconnecting } = useLiveUpdates({
    onEvent: (event) => {
      const rolled = event.type === "day.rollover" && rollTo(event.date);
      if (!rolled) void refresh();
      for (const listener of listenersRef.current) {
        try {
          listener(event);
        } catch (error) {
          console.error("[dashboard] live event listener failed:", error);
        }
      }
    },
    onOpen: () => void refresh(),
  });

  // Minute clock, aligned to the minute boundary. Each tick also catches a missed midnight
  // (the laptop slept through it); a tab coming back into view ticks at once.
  const onTick = useEffectEvent(() => {
    const at = new Date(Date.now() + serverOffsetRef.current);
    setNow(at.toISOString());
    rollTo(localDateString(at, timeZone));
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(() => {
        onTick();
        arm();
      }, msUntilNextMinute(Date.now()) + 50);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onTick();
    };
    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Fallback for day.rollover: our own timer at local midnight in the dashboard zone.
  useEffect(() => {
    if (view.pinned) return;
    const timer = setTimeout(() => onTick(), msUntilNextLocalMidnight(Date.now() + serverOffsetRef.current, timeZone) + 1_000);
    return () => clearTimeout(timer);
  }, [view.date, view.pinned, timeZone]);

  const today = useMemo(() => layers.reduce((data, layer) => layer.update(data), server), [layers, server]);
  const isToday = view.date === localDateString(new Date(now), timeZone);
  const loadingDate = view.date !== server.date;

  const value = useMemo<DashboardContextValue>(
    () => ({
      today,
      date: view.date,
      pinned: view.pinned,
      isToday,
      loadingDate,
      now,
      timeZone,
      reconnecting,
      refreshFailed,
      refresh,
      mutate,
      subscribe,
    }),
    [today, view, isToday, loadingDate, now, timeZone, reconnecting, refreshFailed, refresh, mutate, subscribe],
  );

  const eyebrow = formatEyebrowDate(zonedTimeToUtc(view.date, 12 * 60, timeZone), timeZone);
  const statusText = reconnecting ? "Reconnecting…" : refreshFailed ? "Couldn't update — retrying…" : "";

  return (
    <DashboardContext.Provider value={value}>
      <main className="mx-auto box-border flex max-w-[1360px] flex-col gap-7 px-[clamp(16px,4vw,48px)] pt-10 pb-14">
        <Header
          eyebrow={eyebrow}
          status={
            <>
              <span role="status" className="font-mono text-[12px] leading-normal text-text-muted">
                {statusText}
              </span>
              {isToday ? null : (
                <Link
                  href="/"
                  className="relative font-mono text-[12px] leading-normal text-lilac-text before:absolute before:inset-x-0 before:-inset-y-3.5 hover:text-lily-pink"
                >
                  Back to today
                </Link>
              )}
            </>
          }
        />
        <Banner banner={today.banner} />
        {loadingDate ? (
          <SkeletonPanel title="Timeline" titleSize={36} rows={2} />
        ) : (
          <Timeline timeline={today.timeline} now={now} date={today.date} calendar={today.sources.calendar} />
        )}
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-[2_1_560px] flex-col">
            <WorkingOn activeSprint={today.workingOn.activeSprint} cards={today.workingOn.cards} />
          </div>
          <div className="flex min-w-0 flex-[1_1_300px] flex-col">
            <WarningsRail alerts={today.warnings.alerts} waiting={today.warnings.waiting} sources={today.sources} />
          </div>
        </div>
      </main>
    </DashboardContext.Provider>
  );
}
