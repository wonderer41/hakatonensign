// Timeline motion: a slow continuous drift to the left, a pause at the end,
// an eased jump back to the start, and 600 ms eased jumps for Earlier / Later. Plain DOM + rAF, no React:
// the section creates one AutoScroller per mounted track and calls it from event handlers.

/** Continuous drift speed. */
export const DRIFT_PX_PER_S = 12;
/** Arrow / key jumps and the loop back to the start. */
export const JUMP_MS = 600;
/** Auto-scroll waits this long after Earlier / Later (or a manual scroll) before drifting again. */
export const HOLD_AFTER_INPUT_MS = 10_000;
/** Pause at the end before looping back, and at the start before drifting off. */
export const EDGE_PAUSE_MS = 2_000;
/** A rAF gap longer than this (a busy main thread) is not turned into one big leap. */
const MAX_FRAME_MS = 64;

/**
 * cubic-bezier(.2, .7, .2, 1), the design's ease (`--ease-out-soft`), as a function of progress 0–1.
 * Solves x(t) = p by Newton steps with a bisection fallback, then returns y(t).
 */
export function easeOutSoft(progress: number): number {
  const x1 = 0.2;
  const y1 = 0.7;
  const x2 = 0.2;
  const y2 = 1;
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const bezier = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  const slope = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * a + 6 * (1 - t) * t * (b - a) + 3 * t * t * (1 - b);

  let t = progress;
  for (let i = 0; i < 8; i += 1) {
    const error = bezier(t, x1, x2) - progress;
    if (Math.abs(error) < 1e-6) return bezier(t, y1, y2);
    const d = slope(t, x1, x2);
    if (Math.abs(d) < 1e-6) break;
    t -= error / d;
  }
  let low = 0;
  let high = 1;
  t = progress;
  for (let i = 0; i < 40; i += 1) {
    const x = bezier(t, x1, x2);
    if (Math.abs(x - progress) < 1e-6) break;
    if (x < progress) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return bezier(t, y1, y2);
}

/**
 * Scroll position one card earlier or later. `starts` are the cards' left edges inside the track
 * (ascending); `from` is where the track is (or is already heading); the result stays in [0, max].
 */
export function stepTarget(starts: readonly number[], from: number, direction: -1 | 1, max: number): number {
  const limit = Math.max(0, max);
  if (direction > 0) {
    const next = starts.find((start) => start > from + 1);
    return Math.min(limit, next ?? limit);
  }
  let previous = 0;
  for (const start of starts) {
    if (start < from - 1) previous = start;
    else break;
  }
  return Math.max(0, Math.min(limit, previous));
}

interface Jump {
  from: number;
  to: number;
  startedAt: number;
  then?: () => void;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Drives one horizontal scroll container. Uses native scrolling (so touch, trackpad and keyboard
 * focus all keep working) with a float position of its own, because 12px/s is a fraction of a pixel
 * per frame. Runs only while the tab is visible and reduced motion is off; Earlier / Later still work
 * under reduced motion as instant jumps.
 */
export class AutoScroller {
  private readonly element: HTMLElement;
  private readonly reducedMotion: MediaQueryList;
  private frame = 0;
  private lastFrameAt: number | null = null;
  /** Where the drift is, in px (may be fractional; the browser rounds what it paints). */
  private position = 0;
  /** scrollLeft as read back after our own last write; anything else in a scroll event is the user. */
  private written = 0;
  private hovered = false;
  private focused = false;
  private holdUntil = 0;
  private waitUntil = 0;
  private atEndSince: number | null = null;
  private jump: Jump | null = null;
  private disposed = false;

  constructor(element: HTMLElement) {
    this.element = element;
    this.reducedMotion = window.matchMedia(REDUCED_MOTION);
    this.position = element.scrollLeft;
    this.written = element.scrollLeft;
    this.waitUntil = performance.now() + EDGE_PAUSE_MS;
    element.addEventListener("scroll", this.onScroll, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.reducedMotion.addEventListener("change", this.onMotionPreference);
    this.ensureLoop();
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.element.removeEventListener("scroll", this.onScroll);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.reducedMotion.removeEventListener("change", this.onMotionPreference);
  }

  /** Mouse over the track. */
  setHovered(hovered: boolean): void {
    this.hovered = hovered;
  }

  /** Keyboard focus inside the section (arrows or track). */
  setFocused(focused: boolean): void {
    this.focused = focused;
  }

  /** Earlier (-1) / Later (+1): one card, eased over 600 ms, then hold the drift for 10 s. */
  step(direction: -1 | 1): void {
    const from = this.jump ? this.jump.to : this.element.scrollLeft;
    this.hold();
    this.animateTo(stepTarget(this.cardStarts(), from, direction, this.max()));
  }

  /** Home / End. */
  toEdge(edge: "start" | "end"): void {
    this.hold();
    this.animateTo(edge === "start" ? 0 : this.max());
  }

  private hold(): void {
    this.holdUntil = performance.now() + HOLD_AFTER_INPUT_MS;
    this.atEndSince = null;
  }

  private max(): number {
    return Math.max(0, this.element.scrollWidth - this.element.clientWidth);
  }

  private cardStarts(): number[] {
    const list = this.element.querySelector("ol");
    if (!list) return [];
    return Array.from(list.children, (child) => (child as HTMLElement).offsetLeft);
  }

  private write(x: number): void {
    this.element.scrollLeft = x;
    this.written = this.element.scrollLeft;
  }

  private animateTo(target: number, then?: () => void): void {
    if (this.reducedMotion.matches) {
      this.jump = null;
      this.write(target);
      this.position = target;
      then?.();
      return;
    }
    this.jump = { from: this.element.scrollLeft, to: target, startedAt: performance.now(), then };
    this.ensureLoop();
  }

  private readonly onScroll = (): void => {
    if (Math.abs(this.element.scrollLeft - this.written) <= 1) return;
    // The user scrolled (touch, trackpad, wheel, or the browser bringing focus into view): follow them.
    this.jump = null;
    this.position = this.element.scrollLeft;
    this.written = this.position;
    this.hold();
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible") this.ensureLoop();
    else this.stopLoop();
  };

  private readonly onMotionPreference = (): void => {
    if (this.reducedMotion.matches) {
      const jump = this.jump;
      this.stopLoop();
      if (jump) {
        this.jump = null;
        this.write(jump.to);
        this.position = jump.to;
        jump.then?.();
      }
    } else {
      this.position = this.element.scrollLeft;
      this.ensureLoop();
    }
  };

  private ensureLoop(): void {
    if (this.disposed || this.frame || this.reducedMotion.matches || document.visibilityState !== "visible") return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastFrameAt = null;
  }

  private readonly tick = (time: number): void => {
    this.frame = 0;
    const elapsed = this.lastFrameAt === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, time - this.lastFrameAt));
    this.lastFrameAt = time;
    const now = performance.now();

    if (this.jump) this.advanceJump(now);
    else this.drift(now, elapsed);

    this.ensureLoop();
  };

  private advanceJump(now: number): void {
    const jump = this.jump;
    if (!jump) return;
    const progress = Math.min(1, Math.max(0, (now - jump.startedAt) / JUMP_MS));
    this.write(jump.from + (jump.to - jump.from) * easeOutSoft(progress));
    if (progress < 1) return;
    this.jump = null;
    this.position = jump.to;
    jump.then?.();
  }

  private drift(now: number, elapsed: number): void {
    if (this.hovered || this.focused || now < this.holdUntil || now < this.waitUntil) return;
    const max = this.max();
    if (max <= 0) return;

    if (this.position >= max - 0.5) {
      if (this.atEndSince === null) {
        this.atEndSince = now;
        this.waitUntil = now + EDGE_PAUSE_MS;
        return;
      }
      this.atEndSince = null;
      this.animateTo(0, () => {
        this.waitUntil = performance.now() + EDGE_PAUSE_MS;
      });
      return;
    }

    this.position = Math.min(max, this.position + (DRIFT_PX_PER_S * elapsed) / 1000);
    this.write(this.position);
  }
}
