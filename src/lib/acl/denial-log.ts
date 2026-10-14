export interface DenialLog {
  /** Counts one refused request from `address`; logs at most one line per address per window. */
  record(address: string): void;
  /** Reports counts still pending from windows that have ended and forgets idle addresses. Run it on a timer. */
  flush(): void;
}

export interface DenialLogOptions {
  windowMs?: number;
  now?: () => number;
  write?: (line: string) => void;
  /** Upper bound on remembered addresses; the oldest is reported and dropped past it. */
  maxTracked?: number;
}

interface Entry {
  windowStart: number;
  /** Requests refused since the last line written for this address. */
  pending: number;
}

function line(address: string, count: number): string {
  return `[acl] denied ${address} (${count} ${count === 1 ? "request" : "requests"})`;
}

/**
 * Logs refused clients without flooding: the first refusal from an address is logged right away,
 * the rest within the same window are counted and reported as one line when the window ends
 * (on the next refusal or the next flush). Only the address and a count are ever logged.
 */
export function createDenialLog(options: DenialLogOptions = {}): DenialLog {
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const write = options.write ?? ((text: string) => console.warn(text));
  const maxTracked = options.maxTracked ?? 10_000;
  const entries = new Map<string, Entry>();

  function report(address: string, entry: Entry, at: number): void {
    write(line(address, entry.pending));
    entry.windowStart = at;
    entry.pending = 0;
  }

  return {
    record(address) {
      const at = now();
      const entry = entries.get(address);
      if (!entry) {
        if (entries.size >= maxTracked) {
          const [oldestAddress, oldest] = entries.entries().next().value as [string, Entry];
          if (oldest.pending > 0) write(line(oldestAddress, oldest.pending));
          entries.delete(oldestAddress);
        }
        entries.set(address, { windowStart: at, pending: 0 });
        write(line(address, 1));
        return;
      }
      entry.pending += 1;
      if (at - entry.windowStart >= windowMs) report(address, entry, at);
    },
    flush() {
      const at = now();
      for (const [address, entry] of entries) {
        if (at - entry.windowStart < windowMs) continue;
        if (entry.pending > 0) report(address, entry, at);
        else entries.delete(address);
      }
    },
  };
}
