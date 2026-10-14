import { GlassPanel } from "@/components/ui/glass-panel";
import { SourceDown } from "@/components/ui/source-down";
import { SectionTitle } from "@/components/ui/typography";
import { formatClock } from "@/lib/time/zone";
import type { SourceStateDto, TimelineResponse } from "@/types/dashboard-contracts";
import { useDashboard } from "../context";

export interface TimelineProps {
  timeline: TimelineResponse;
  /** ISO time, ticks every minute: the now marker and past/current/future dimming. */
  now: string;
  /** The day shown (YYYY-MM-DD, dashboard zone). */
  date: string;
  /** Calendar health: render <SourceDown name="Calendar" …> when it isn't ok. */
  calendar: SourceStateDto;
}

/**
 * STUB — the timeline agent replaces the body (cards on a line, gaps, now marker, auto-scroll;
 * see sections/README.md). Keep the export name and props.
 */
export function Timeline({ timeline, now, date, calendar }: TimelineProps) {
  const { timeZone } = useDashboard();
  return (
    <GlassPanel aria-label="Timeline" className="flex flex-col gap-3.5">
      <SectionTitle size={36}>Timeline</SectionTitle>
      <p className="m-0 text-[15px] text-text">
        Placeholder · {timeline.events.length} events and {timeline.allDay.length} all-day on {date} · now{" "}
        {formatClock(new Date(now), timeZone)}
      </p>
      <SourceDown name="Calendar" source={calendar} timeZone={timeZone} now={now} />
    </GlassPanel>
  );
}
