import type { TodayResponse } from "@/types/dashboard-contracts";
import { isAbortError } from "./api";
import { backoffDelay, realTimers, type Timers } from "./timing";

/** Which day the page shows. `pinned` = the URL named a date (?date=); otherwise the page follows today. */
export interface FeedView {
  date: string;
  pinned: boolean;
}

/**
 * The /api/today URL for a view. A page that follows today asks without a date so the server's
 * clock decides what "today" is (no client/server skew around midnight); a pinned page asks for its date.
 */
export function todayUrl(view: FeedView): string {
  return view.pinned ? `/api/today?date=${encodeURIComponent(view.date)}` : "/api/today";
}

export interface TodayFeedOptions {
  view: FeedView;
  load: (url: string, signal: AbortSignal) => Promise<TodayResponse>;
  /** A fresh response. `view` is the feed's view after it (a page that follows today adopts the server's date). */
  onData: (today: TodayResponse, view: FeedView) => void;
  /** A refresh failed; the feed retries by itself after `retryInMs`. */
  onError: (error: unknown, retryInMs: number) => void;
  /** Bursts of refresh() calls within this window become one request. */
  debounceMs?: number;
  /** …but a steady stream of calls still fetches at least this often. */
  maxWaitMs?: number;
  timers?: Timers;
}

interface Flight {
  controller: AbortController;
  waiters: Array<() => void>;
}

/**
 * Loads TodayResponse for the page: coalesces bursts (300 ms debounce, 1 s max wait), aborts the
 * request in flight when a newer one starts, and retries failures with backoff (1 s → 30 s).
 * Plain TypeScript so it can be tested without React; <Dashboard> owns one per mount.
 */
export class TodayFeed {
  private view: FeedView;
  private readonly timers: Timers;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private debounceTimer: unknown = null;
  private retryTimer: unknown = null;
  private firstAskAt: number | null = null;
  private queued: Array<() => void> = [];
  private inflight: Flight | null = null;
  private failures = 0;
  private disposed = false;

  constructor(private readonly options: TodayFeedOptions) {
    this.view = options.view;
    this.timers = options.timers ?? realTimers;
    this.debounceMs = options.debounceMs ?? 300;
    this.maxWaitMs = options.maxWaitMs ?? 1_000;
  }

  get currentView(): FeedView {
    return this.view;
  }

  /** Switches to another day (rollover) and loads it right away. */
  setView(view: FeedView): Promise<void> {
    this.view = view;
    return this.request({ immediate: true });
  }

  /**
   * Asks for a refetch. Resolves once a request that started after this call has settled
   * (successfully or not; failures go to onError). Never rejects.
   */
  request(options: { immediate?: boolean } = {}): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const settled = new Promise<void>((resolve) => this.queued.push(resolve));
    const now = this.timers.now();
    this.firstAskAt ??= now;
    const wait = options.immediate ? 0 : Math.max(0, Math.min(this.debounceMs, this.firstAskAt + this.maxWaitMs - now));
    this.clearTimer("debounce");
    this.debounceTimer = this.timers.setTimeout(() => this.run(), wait);
    return settled;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer("debounce");
    this.clearTimer("retry");
    const waiters = [...(this.inflight?.waiters ?? []), ...this.queued];
    this.inflight?.controller.abort();
    this.inflight = null;
    this.queued = [];
    for (const resolve of waiters) resolve();
  }

  private clearTimer(which: "debounce" | "retry"): void {
    const handle = which === "debounce" ? this.debounceTimer : this.retryTimer;
    if (handle !== null) this.timers.clearTimeout(handle);
    if (which === "debounce") this.debounceTimer = null;
    else this.retryTimer = null;
  }

  private run(): void {
    if (this.disposed) return;
    this.clearTimer("debounce");
    this.clearTimer("retry");
    this.firstAskAt = null;

    // A newer request replaces the one in flight; whoever waited on the old one now waits on this one.
    const previous = this.inflight;
    const flight: Flight = { controller: new AbortController(), waiters: [...(previous?.waiters ?? []), ...this.queued] };
    this.queued = [];
    this.inflight = flight;
    previous?.controller.abort();

    const view = this.view;
    const finish = () => {
      this.inflight = null;
      for (const resolve of flight.waiters) resolve();
    };

    this.options.load(todayUrl(view), flight.controller.signal).then(
      (today) => {
        if (this.inflight !== flight) return;
        this.failures = 0;
        let next = this.view;
        if (next === view && !view.pinned && today.date !== view.date) {
          next = { ...view, date: today.date };
          this.view = next;
        }
        this.options.onData(today, next);
        finish();
      },
      (error: unknown) => {
        if (this.inflight !== flight) return;
        if (isAbortError(error)) {
          finish();
          return;
        }
        const retryInMs = backoffDelay(this.failures);
        this.failures += 1;
        this.retryTimer = this.timers.setTimeout(() => this.run(), retryInMs);
        this.options.onError(error, retryInMs);
        finish();
      },
    );
  }
}
