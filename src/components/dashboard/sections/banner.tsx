import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import type { BannerDto } from "@/types/dashboard-contracts";
import { useDashboard } from "../context";
import "./banner.css";
import { DailyMessageSlide } from "./banner/daily-message-slide";
import { formatClockOrDay } from "./banner/format";
import { GmailSlide } from "./banner/gmail-slide";
import { InfraSlide } from "./banner/infra-slide";
import { availableSlides, oldestSlide, SLIDE_LABELS, type SlideId } from "./banner/slides";
import { StocksSlide } from "./banner/stocks-slide";
import { useCarousel } from "./banner/use-carousel";
import { usePrefersReducedMotion } from "./banner/use-reduced-motion";

export interface BannerProps {
  banner: BannerDto;
}

interface SlideBodyProps {
  id: SlideId;
  banner: BannerDto;
  timeZone: string;
  now: Date;
}

function SlideBody({ id, banner, timeZone, now }: SlideBodyProps) {
  switch (id) {
    case "message":
      return banner.dailyMessage ? <DailyMessageSlide message={banner.dailyMessage} /> : null;
    case "gmail":
      return banner.gmail ? <GmailSlide data={banner.gmail.data} timeZone={timeZone} now={now} /> : null;
    case "infra":
      return <InfraSlide orphans={banner.orphans?.data ?? null} scan={banner.scan?.data ?? null} timeZone={timeZone} now={now} />;
    case "stocks":
      return banner.stocks ? <StocksSlide data={banner.stocks.data} /> : null;
  }
}

/**
 * The banner: a glass panel that slides between the daily message, Gmail, orphans + daily scan and
 * stocks. Slides with no data are skipped; the one whose snapshot is oldest carries "as of HH:MM".
 * Autoplay every 7 s (off under prefers-reduced-motion), paused while hovered or keyboard-focused.
 */
export function Banner({ banner }: BannerProps) {
  const { timeZone, now: nowIso } = useDashboard();
  const reducedMotion = usePrefersReducedMotion();
  const ids = availableSlides(banner);
  const carousel = useCarousel(ids, { reducedMotion });

  if (ids.length === 0) {
    return (
      <GlassPanel aria-label="Daily banner" pad="none">
        <p className="banner-empty">Nothing in the banner yet.</p>
      </GlassPanel>
    );
  }

  const now = new Date(nowIso);
  const oldest = oldestSlide(banner, ids);
  const asOf = oldest && oldest.id === carousel.activeId ? formatClockOrDay(new Date(oldest.capturedAt), now, timeZone) : "";
  const multiple = ids.length > 1;

  return (
    <GlassPanel aria-label="Daily banner" aria-roledescription={multiple ? "carousel" : undefined} pad="none" {...(multiple ? carousel.rootProps : {})}>
      <div className="banner__viewport" aria-live={carousel.playing ? "off" : "polite"}>
        <div
          className="banner__track"
          data-still={reducedMotion ? "" : undefined}
          style={{ transform: `translateX(-${carousel.activeIndex * 100}%)` }}
        >
          {ids.map((id, index) => {
            const active = index === carousel.activeIndex;
            return (
              <div
                key={id}
                className={`banner__slide banner__slide--${id}`}
                data-carousel-slide=""
                role="group"
                aria-roledescription={multiple ? "slide" : undefined}
                aria-label={multiple ? `${index + 1} of ${ids.length}: ${SLIDE_LABELS[id]}` : SLIDE_LABELS[id]}
                aria-hidden={active ? undefined : true}
                inert={!active}
              >
                <SlideBody id={id} banner={banner} timeZone={timeZone} now={now} />
              </div>
            );
          })}
        </div>
      </div>

      {multiple || asOf ? (
        <div className="banner__footer">
          <p className="banner__asof">{asOf ? `as of ${asOf}` : null}</p>
          {multiple ? (
            <div className="banner__controls">
              <Button variant="icon" aria-label="Previous slide" onClick={carousel.previous}>
                <ChevronLeftIcon size={18} />
              </Button>
              <div className="banner__dots" role="group" aria-label="Choose a slide">
                {ids.map((id, index) => (
                  <button
                    key={id}
                    type="button"
                    className="banner__dot"
                    aria-label={`Slide ${index + 1} of ${ids.length}: ${SLIDE_LABELS[id]}`}
                    aria-current={index === carousel.activeIndex ? "true" : undefined}
                    onClick={() => carousel.select(id)}
                  />
                ))}
              </div>
              <Button variant="icon" aria-label="Next slide" onClick={carousel.next}>
                <ChevronRightIcon size={18} />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </GlassPanel>
  );
}
