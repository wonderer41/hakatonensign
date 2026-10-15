import type { LiveEvent } from "@/types/dashboard-contracts";
import { backoffDelay, realTimers, type Timers } from "./timing";

// Client side of GET /api/stream.
// Events are `event: change` with a LiveEvent as data, and `event: ping` every 25 s.

/** The part of the browser's EventSource this file uses (a fake in tests). */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
}

/**
 * Reads the `data` of a `change` message. The server validated the event before sending it
 * (src/lib/live/event.ts), so this only checks the shape the page relies on: a string `type`.
 */
export function parseLiveEventData(data: unknown): LiveEvent | null {
  if (typeof data !== "string") return null;
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string") return value as LiveEvent;
  } catch {
    // ignored: a malformed message is dropped
  }
  return null;
}

export interface LiveConnectionOptions {
  url: string;
  onEvent: (event: LiveEvent) => void;
  /** Every successful (re)connect. Events sent while disconnected are gone, so refetch here. */
  onOpen: () => void;
  /** true once the stream has been down for `graceMs`; false as soon as it is back. */
  onReconnectingChange: (reconnecting: boolean) => void;
  createSource?: (url: string) => EventSourceLike;
  timers?: Timers;
  /** No message (change or ping) for this long means the connection is dead. Server pings every 25 s. */
  silenceMs?: number;
  /** Don't flash "Reconnecting…" for drops that recover faster than this. */
  graceMs?: number;
}

/**
 * One EventSource with our own reconnect policy: on any error the source is closed and reopened
 * after an exponential backoff (1 s, 2 s, 4 s … 30 s), instead of relying on the browser's fixed
 * retry, which also never retries once the source is CLOSED (e.g. after an HTTP error).
 */
export class LiveConnection {
  private source: EventSourceLike | null = null;
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private silenceTimer: unknown = null;
  private graceTimer: unknown = null;
  private reconnecting = false;
  private running = false;
  private readonly timers: Timers;

  constructor(private readonly options: LiveConnectionOptions) {
    this.timers = options.timers ?? realTimers;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.source?.close();
    this.source = null;
    for (const handle of [this.reconnectTimer, this.silenceTimer, this.graceTimer]) if (handle !== null) this.timers.clearTimeout(handle);
    this.reconnectTimer = this.silenceTimer = this.graceTimer = null;
  }

  /** Reconnect now instead of waiting out the backoff (the browser came back online or the tab became visible). */
  wake(): void {
    if (!this.running || this.source !== null) return;
    if (this.reconnectTimer !== null) this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempt = 0;
    this.connect();
  }

  private connect(): void {
    const createSource = this.options.createSource ?? ((url: string) => new EventSource(url));
    const source = createSource(this.options.url);
    this.source = source;
    this.armSilence();

    source.addEventListener("open", () => {
      if (this.source !== source) return;
      this.attempt = 0;
      this.armSilence();
      this.setReconnecting(false);
      this.options.onOpen();
    });
    source.addEventListener("change", (message) => {
      if (this.source !== source) return;
      this.armSilence();
      const event = parseLiveEventData(message.data);
      if (event) this.options.onEvent(event);
    });
    source.addEventListener("ping", () => {
      if (this.source === source) this.armSilence();
    });
    source.addEventListener("error", () => {
      if (this.source === source) this.drop();
    });
  }

  private drop(): void {
    this.source?.close();
    this.source = null;
    if (this.silenceTimer !== null) this.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    if (!this.running) return;

    if (!this.reconnecting && this.graceTimer === null) {
      this.graceTimer = this.timers.setTimeout(() => {
        this.graceTimer = null;
        this.setReconnecting(true);
      }, this.options.graceMs ?? 1_500);
    }
    const delay = backoffDelay(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) this.connect();
    }, delay);
  }

  private armSilence(): void {
    if (this.silenceTimer !== null) this.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = this.timers.setTimeout(() => {
      this.silenceTimer = null;
      this.drop();
    }, this.options.silenceMs ?? 60_000);
  }

  private setReconnecting(value: boolean): void {
    if (!value && this.graceTimer !== null) {
      this.timers.clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    if (this.reconnecting === value) return;
    this.reconnecting = value;
    this.options.onReconnectingChange(value);
  }
}
