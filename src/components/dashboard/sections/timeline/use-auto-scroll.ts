import { useCallback, useEffect, useRef, type FocusEvent, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { AutoScroller } from "./motion";

export interface AutoScrollControls {
  /** Attach to the scroll container (its first <ol> holds the cards). */
  viewportRef: RefObject<HTMLDivElement | null>;
  earlier: () => void;
  later: () => void;
  /** Arrow keys step one card; Home / End go to the ends. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  /** Put both on the section so keyboard focus anywhere inside (arrows or track) pauses the drift. */
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * One AutoScroller per mounted track. `resetKey` (the day shown) starts the track over from the left;
 * `active` is false while there is no track (empty day).
 */
export function useAutoScroll(resetKey: string, active: boolean): AutoScrollControls {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<AutoScroller | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!active || !element) return;
    element.scrollLeft = 0;
    const scroller = new AutoScroller(element);
    scrollerRef.current = scroller;
    return () => {
      scroller.dispose();
      if (scrollerRef.current === scroller) scrollerRef.current = null;
    };
  }, [resetKey, active]);

  const earlier = useCallback(() => scrollerRef.current?.step(-1), []);
  const later = useCallback(() => scrollerRef.current?.step(1), []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (event.key === "ArrowLeft") scroller.step(-1);
    else if (event.key === "ArrowRight") scroller.step(1);
    else if (event.key === "Home") scroller.toEdge("start");
    else if (event.key === "End") scroller.toEdge("end");
    else return;
    event.preventDefault();
  }, []);

  // Touch has no hover; a finger on the track shows up as a manual scroll, which holds the drift instead.
  const onPointerEnter = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") scrollerRef.current?.setHovered(true);
  }, []);
  const onPointerLeave = useCallback(() => scrollerRef.current?.setHovered(false), []);

  // Only keyboard focus pauses: a mouse click on Earlier / Later leaves focus on the button, and that
  // should hold the drift for 10 s, not stop it until the next click elsewhere.
  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.matches(":focus-visible")) scrollerRef.current?.setFocused(true);
  }, []);
  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    scrollerRef.current?.setFocused(false);
  }, []);

  return { viewportRef, earlier, later, onKeyDown, onPointerEnter, onPointerLeave, onFocus, onBlur };
}
