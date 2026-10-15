import { useId } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { SourceDown } from "@/components/ui/source-down";
import { SectionTitle } from "@/components/ui/typography";
import type { SourceStateDto, TimelineResponse } from "@/types/dashboard-contracts";
import { useDashboard } from "../context";
import { GapLegend } from "./timeline/legend";
import { buildTimelineView } from "./timeline/model";
import { TimelineTrack } from "./timeline/track";
import { useAutoScroll } from "./timeline/use-auto-scroll";
import "./timeline.css";

export interface TimelineProps {
  timeline: TimelineResponse;
  /** ISO time, ticks every minute: the now marker and past/current/future dimming. */
  now: string;
  /** The day shown (YYYY-MM-DD, dashboard zone). */
  date: string;
  /** Calendar health: render <SourceDown name="Calendar" …> when it isn't ok. */
  calendar: SourceStateDto;
}

function countLabel(count: number, today: boolean): string {
  const events = `${count} ${count === 1 ? "event" : "events"}`;
  return `calendar · ${today ? `${events} today` : events}`;
}

/**
 * The day's calendar as a row of cards on a line, sitting on the painting (no glass panel): gaps
 * above the line, a dashed lilac "now" card on today's date, all-day chips first. Drifts left at
 * ~12px/s and loops; Earlier / Later, arrow keys, touch and trackpad all scroll it too.
 */
export function Timeline({ timeline, now, date, calendar }: TimelineProps) {
  const { timeZone } = useDashboard();
  const view = buildTimelineView(timeline, now, date, timeZone);
  const isToday = view.relation === "today";
  const empty = view.eventCount === 0;
  const { viewportRef, earlier, later, onKeyDown, onPointerEnter, onPointerLeave, onFocus, onBlur } = useAutoScroll(date, !empty);

  const titleId = useId();
  const trackId = useId();
  const hintId = useId();

  return (
    <section className="tl" aria-labelledby={titleId} onFocus={onFocus} onBlur={onBlur}>
      <div className="tl-head">
        <div className="tl-head__title">
          <SectionTitle id={titleId} size={36}>
            Timeline
          </SectionTitle>
          <span className="tl-head__meta">{countLabel(view.eventCount, isToday)}</span>
        </div>
        <div className="tl-head__tools">
          <GapLegend />
          {empty ? null : (
            <div className="tl-head__arrows">
              <Button variant="icon" aria-label="Earlier events" aria-controls={trackId} onClick={earlier}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="icon" aria-label="Later events" aria-controls={trackId} onClick={later}>
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </div>
      </div>

      <SourceDown name="Calendar" source={calendar} timeZone={timeZone} now={now} className="tl-source-down" />

      {empty ? (
        <p className="tl-empty">{isToday ? "No events today." : "No events this day."}</p>
      ) : (
        <div
          ref={viewportRef}
          id={trackId}
          className="tl-viewport"
          role="region"
          aria-label="Timeline events"
          aria-describedby={hintId}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
        >
          <TimelineTrack allDay={view.allDay} items={view.items} />
        </div>
      )}
      {empty ? null : (
        <span id={hintId} className="sr-only">
          Left and right arrow keys step one card; Home and End go to the first and last.
        </span>
      )}
    </section>
  );
}
