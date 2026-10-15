import { withErrorHandling } from "@/lib/api/http";
import { formatSseEvent, SSE_HEADERS, SSE_OPEN_COMMENT, SSE_PING_INTERVAL_MS } from "@/lib/live/sse";
import { getLiveSubscriber } from "@/lib/live/subscribe";

// Live updates: one long-lived SSE response per open page.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withErrorHandling(async (request: Request) => {
  // Setup errors (no DATABASE_URL) surface as the usual error envelope before streaming starts.
  const subscriber = getLiveSubscriber();
  const encoder = new TextEncoder();
  let teardown: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      // After a LISTEN reconnect, events may have been missed: end the stream so the
      // browser reconnects and refetches instead of showing stale data.
      const unsubscribe = subscriber.subscribe((event) => send(formatSseEvent("change", event)), { onReconnect: () => close() });
      const ping = setInterval(() => send(formatSseEvent("ping", {})), SSE_PING_INTERVAL_MS);

      function close() {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      }

      teardown = close;
      if (request.signal.aborted) {
        close();
        return;
      }
      request.signal.addEventListener("abort", close, { once: true });
      send(SSE_OPEN_COMMENT);
    },
    cancel() {
      teardown();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
});
