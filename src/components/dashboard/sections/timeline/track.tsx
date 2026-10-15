import { Chip } from "@/components/ui/chip";
import { cx } from "@/components/ui/cx";
import type { AllDayView, EventCardView, GapView, MarkerStyle, NowCardView, TrackItem } from "./model";

// Each <li> is a 280px column: gap label (row 1), marker + line to the next marker (row 2), card (row 3).
// The card comes first in the DOM so a screen reader hears "card, then 36m free before the next item".

function Rail({ marker, gap }: { marker: MarkerStyle | null; gap: GapView | null }) {
  return (
    <div className="tl-rail" aria-hidden="true">
      {marker ? <span className={`tl-marker tl-marker--${marker}`} /> : null}
      <span className="tl-line" data-tone={gap?.tone} />
    </div>
  );
}

function Gap({ gap }: { gap: GapView | null }) {
  if (!gap) return <div className="tl-gap" aria-hidden="true" />;
  return (
    <div className="tl-gap" data-tone={gap.tone}>
      <span aria-hidden="true">{gap.label}</span>
      <span className="sr-only">{gap.description}</span>
    </div>
  );
}

function EventCard({ item }: { item: EventCardView }) {
  return (
    <li className="tl-item">
      <div
        className={cx("tl-card", item.workBlock && "tl-card--work-block", item.state === "past" && "tl-card--past")}
      >
        <p className="tl-time">
          <time dateTime={item.startsAt}>{item.start}</time>–<time dateTime={item.endsAt}>{item.end}</time>{" "}
          <span className="tl-source">· {item.source}</span>
        </p>
        <p className="tl-title" title={item.title}>
          {item.title}
        </p>
      </div>
      <Gap gap={item.gap} />
      <Rail marker={item.marker} gap={item.gap} />
    </li>
  );
}

function NowCard({ item }: { item: NowCardView }) {
  return (
    <li className="tl-item" aria-current="time">
      <div className="tl-card tl-card--now">
        <p className="tl-time">
          <time dateTime={item.at}>{item.time}</time> <span className="tl-source">· now</span>
        </p>
        <p className="tl-title">Now</p>
      </div>
      <Gap gap={item.gap} />
      <Rail marker="now" gap={item.gap} />
    </li>
  );
}

function AllDay({ events }: { events: AllDayView[] }) {
  const done = events.every((event) => event.state === "past");
  return (
    <li className={cx("tl-item tl-item--all-day", done && "tl-item--done")}>
      <div className="tl-all-day">
        <p className="tl-all-day__label">{done ? "all day · done" : "all day"}</p>
        <ul className="tl-all-day__list">
          {events.map((event) => (
            <li key={event.id} className="tl-all-day__entry">
              <Chip tone="open" className="tl-chip" title={event.title}>
                {event.title}
              </Chip>
            </li>
          ))}
        </ul>
      </div>
      <div className="tl-gap" aria-hidden="true" />
      <Rail marker={null} gap={null} />
    </li>
  );
}

export function TimelineTrack({ allDay, items }: { allDay: AllDayView[]; items: TrackItem[] }) {
  return (
    <ol className="tl-list">
      {allDay.length > 0 ? <AllDay events={allDay} /> : null}
      {items.map((item) => (item.type === "now" ? <NowCard key={item.id} item={item} /> : <EventCard key={item.id} item={item} />))}
    </ol>
  );
}
