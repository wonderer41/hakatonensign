// Server-Sent Events framing for /api/stream.

export const SSE_PING_INTERVAL_MS = 25_000;

/** Sent first so proxies flush the response headers right away. */
export const SSE_OPEN_COMMENT = ": connected\n\n";

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Nginx (and Nginx Proxy Manager) buffers proxied responses unless told not to.
  "X-Accel-Buffering": "no",
};

/** One SSE message. JSON.stringify never emits raw newlines, so `data` stays on one line. */
export function formatSseEvent(event: "change" | "ping", data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
