import { useEffect, useEffectEvent, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { resolveActiveIndex, stepId } from "./carousel-state";

/** The banner advances every 7 s. */
export const AUTOPLAY_MS = 7000;

// Keyboard focus pauses the slider; a dot clicked with the mouse keeps focus but must not freeze it.
function isKeyboardFocus(target: EventTarget): boolean {
  try {
    return target instanceof Element ? target.matches(":focus-visible") : true;
  } catch {
    return true;
  }
}

export interface UseCarouselOptions {
  /** prefers-reduced-motion: no autoplay. */
  reducedMotion: boolean;
  intervalMs?: number;
}

/**
 * Selection, autoplay and keyboard for the banner slider.
 *
 * The selection is kept by slide id, so a live update that adds or drops other slides leaves the
 * visible slide alone; when the visible slide itself disappears the first slide shows.
 * Autoplay is a timeout re-armed on every slide change, so a manual jump gets a full 7 s, and it
 * waits while the pointer is over the slider (mouse or pen, not touch) or keyboard focus is inside.
 */
export function useCarousel<Id extends string>(ids: readonly Id[], { reducedMotion, intervalMs = AUTOPLAY_MS }: UseCarouselOptions) {
  const [selected, setSelected] = useState<Id | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const activeIndex = resolveActiveIndex(ids, selected);
  const activeId = ids[activeIndex] ?? null;
  const playing = ids.length > 1 && !reducedMotion && !hovered && !focused;

  const advance = useEffectEvent(() => setSelected(stepId(ids, activeId, 1)));
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => advance(), intervalMs);
    return () => window.clearTimeout(timer);
  }, [playing, activeId, intervalMs]);

  const step = (delta: number) => setSelected(stepId(ids, activeId, delta));

  return {
    activeIndex,
    activeId,
    /** Autoplay is running right now (drives aria-live: quiet while rotating, polite otherwise). */
    playing,
    next: () => step(1),
    previous: () => step(-1),
    select: (id: Id) => setSelected(id),
    /** Spread on the element that contains every control and slide. */
    rootProps: {
      onPointerEnter: (event: PointerEvent) => {
        if (event.pointerType !== "touch") setHovered(true);
      },
      onPointerLeave: (event: PointerEvent) => {
        if (event.pointerType !== "touch") setHovered(false);
      },
      onFocus: (event: FocusEvent) => setFocused(isKeyboardFocus(event.target)),
      onBlur: (event: FocusEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        // Focus on a link inside a slide would be lost when that slide goes inert: hand it to the current dot.
        if (event.target instanceof Element && event.target.closest("[data-carousel-slide]")) {
          event.currentTarget.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
        }
        switch (event.key) {
          case "ArrowLeft":
            step(-1);
            break;
          case "ArrowRight":
            step(1);
            break;
          case "Home":
            setSelected(ids[0] ?? null);
            break;
          case "End":
            setSelected(ids[ids.length - 1] ?? null);
            break;
          default:
            return;
        }
        event.preventDefault();
      },
    },
  };
}
