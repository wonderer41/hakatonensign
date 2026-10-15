import pg from "pg";
import type { LiveEvent } from "@/types/dashboard-contracts";
import { LIVE_CHANNEL } from "./channel";
import { parseLiveEventPayload } from "./event";
import { safeErrorMessage } from "./redact";

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/** Wait before reconnect attempt `failures` (0-based): 1s, 2s, 4s, 8s, 16s, then 30s. */
export function reconnectDelayMs(failures: number): number {
  const exponent = Math.max(0, Math.floor(failures));
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.min(exponent, 30));
}

export type LiveListener = (event: LiveEvent) => void;

export interface LiveSubscribeOptions {
  /**
   * Called when the LISTEN connection comes back after a drop. Events published while it was
   * down are gone, so the subscriber should treat its view as stale (the stream route closes
   * the SSE connection; the browser reconnects and refetches).
   */
  onReconnect?: () => void;
}

interface Subscription {
  listener: LiveListener;
  onReconnect?: () => void;
  /** Added while LISTEN was down (or not up yet): events until it comes up are missed. */
  catchUp: boolean;
}

type State = "idle" | "connecting" | "listening" | "waiting" | "closed";

/** One dedicated LISTEN connection per process, fanned out to in-process subscribers. */
export class LiveSubscriber {
  private readonly subscriptions = new Set<Subscription>();
  private client: pg.Client | null = null;
  private state: State = "idle";
  private failures = 0;
  private everListened = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly connectionString: string) {}

  get listening(): boolean {
    return this.state === "listening";
  }

  get subscriberCount(): number {
    return this.subscriptions.size;
  }

  /** Adds a listener and connects on first use. Returns the unsubscribe function. */
  subscribe(listener: LiveListener, options: LiveSubscribeOptions = {}): () => void {
    const subscription: Subscription = { listener, onReconnect: options.onReconnect, catchUp: this.state !== "listening" };
    this.subscriptions.add(subscription);
    if (this.state === "idle") void this.connect();
    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  /** Stops listening for good (used by scripts on shutdown). */
  async close(): Promise<void> {
    this.state = "closed";
    this.subscriptions.clear();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      client.on("error", () => {});
      await client.end().catch(() => {});
    }
  }

  private async connect(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "connecting";
    const client = new pg.Client({
      connectionString: this.connectionString,
      keepAlive: true,
      application_name: "homelab-daily-live",
    });
    this.client = client;
    client.on("notification", (message) => {
      if (message.channel === LIVE_CHANNEL) this.dispatch(message.payload);
    });
    client.on("error", (error) => this.drop(client, error));
    client.on("end", () => this.drop(client, null));

    try {
      await client.connect();
      await client.query(`LISTEN ${client.escapeIdentifier(LIVE_CHANNEL)}`);
    } catch (error) {
      this.drop(client, error);
      return;
    }
    if (this.client !== client || this.state !== "connecting") return;

    this.state = "listening";
    this.failures = 0;
    const reconnected = this.everListened;
    this.everListened = true;
    console.log(`[live] ${reconnected ? "reconnected, listening" : "listening"} on ${LIVE_CHANNEL}`);
    for (const subscription of [...this.subscriptions]) {
      if (!reconnected && !subscription.catchUp) continue;
      subscription.catchUp = false;
      try {
        subscription.onReconnect?.();
      } catch (error) {
        console.error(`[live] reconnect handler failed: ${safeErrorMessage(error)}`);
      }
    }
  }

  private dispatch(payload: string | undefined): void {
    const event = parseLiveEventPayload(payload);
    if (!event) {
      console.warn("[live] ignored a malformed notification");
      return;
    }
    for (const subscription of [...this.subscriptions]) {
      try {
        subscription.listener(event);
      } catch (error) {
        console.error(`[live] listener failed: ${safeErrorMessage(error)}`);
      }
    }
  }

  private drop(client: pg.Client, error: unknown): void {
    if (this.client !== client) return;
    this.client = null;
    client.removeAllListeners();
    client.on("error", () => {});
    void client.end().catch(() => {});
    if (this.state === "closed") return;

    const delay = reconnectDelayMs(this.failures);
    this.failures += 1;
    this.state = "waiting";
    const reason = error ? safeErrorMessage(error) : "connection closed";
    console.warn(`[live] LISTEN connection lost (${reason}); retrying in ${delay / 1000}s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }
}

// Same globalThis pattern as src/lib/db/prisma.ts, but kept in production too: Next.js may load
// this module more than once per process, and there must be only one LISTEN connection.
const globalForLive = globalThis as unknown as { liveSubscriber?: LiveSubscriber };

/** The process-wide subscriber. Throws if DATABASE_URL is missing. */
export function getLiveSubscriber(env: NodeJS.ProcessEnv = process.env): LiveSubscriber {
  if (!globalForLive.liveSubscriber) {
    const connectionString = env.DATABASE_URL?.trim();
    if (!connectionString) throw new Error("DATABASE_URL is not configured");
    globalForLive.liveSubscriber = new LiveSubscriber(connectionString);
  }
  return globalForLive.liveSubscriber;
}

/** Receive every LiveEvent published by any process. Returns the unsubscribe function. */
export function subscribeLiveEvents(listener: LiveListener, options?: LiveSubscribeOptions): () => void {
  return getLiveSubscriber().subscribe(listener, options);
}

/** Closes the process-wide subscriber, if one was started. */
export async function closeLiveSubscriber(): Promise<void> {
  const subscriber = globalForLive.liveSubscriber;
  globalForLive.liveSubscriber = undefined;
  await subscriber?.close();
}
