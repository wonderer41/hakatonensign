import { useEffect, useEffectEvent, useState } from "react";
import type { LiveEvent } from "@/types/dashboard-contracts";
import { LiveConnection } from "./live-connection";

export interface LiveUpdateHandlers {
  /** Every `change` event from the stream. */
  onEvent: (event: LiveEvent) => void;
  /** Every (re)connect, including the first: refetch, because events sent while disconnected are lost. */
  onOpen: () => void;
}

/**
 * Subscribes to GET /api/stream for the life of the component and reconnects with backoff.
 * Handlers always see the latest render's values. Returns whether the stream is currently down.
 */
export function useLiveUpdates(handlers: LiveUpdateHandlers, url = "/api/stream"): { reconnecting: boolean } {
  const [reconnecting, setReconnecting] = useState(false);
  const onEvent = useEffectEvent(handlers.onEvent);
  const onOpen = useEffectEvent(handlers.onOpen);

  useEffect(() => {
    const connection = new LiveConnection({
      url,
      onEvent: (event) => onEvent(event),
      onOpen: () => onOpen(),
      onReconnectingChange: setReconnecting,
    });
    const wake = () => {
      if (document.visibilityState === "visible") connection.wake();
    };
    connection.start();
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      connection.stop();
    };
  }, [url]);

  return { reconnecting };
}
