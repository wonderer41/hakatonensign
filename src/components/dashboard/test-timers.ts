import type { Timers } from "./timing";

/** Lets pending promise callbacks run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Manual clock for tests: timers fire only inside advance(), in time order. */
export function fakeTimers(start = 0) {
  let now = start;
  let seq = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();

  const timers: Timers = {
    setTimeout(callback, ms) {
      seq += 1;
      pending.set(seq, { at: now + ms, callback });
      return seq;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
    now: () => now,
  };

  async function advance(ms: number): Promise<void> {
    const target = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].callback();
      await flush();
    }
    now = target;
    await flush();
  }

  return { timers, advance, now: () => now, pendingCount: () => pending.size };
}
