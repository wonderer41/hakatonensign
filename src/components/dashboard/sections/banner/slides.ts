import type { BannerDto } from "@/types/dashboard-contracts";

/** The four slides, in display order. "infra" is Orphans + Daily scan. */
export type SlideId = "message" | "gmail" | "infra" | "stocks";

export const SLIDE_LABELS: Record<SlideId, string> = {
  message: "Daily message",
  gmail: "Gmail",
  infra: "Orphans and daily scan",
  stocks: "Stocks",
};

/** Slides that have data, in order. A slide with no data is skipped. */
export function availableSlides(banner: BannerDto): SlideId[] {
  const slides: SlideId[] = [];
  if (banner.dailyMessage && banner.dailyMessage.text.trim() !== "") slides.push("message");
  if (banner.gmail) slides.push("gmail");
  if (banner.orphans || banner.scan) slides.push("infra");
  if (banner.stocks && banner.stocks.data.rows.length > 0) slides.push("stocks");
  return slides;
}

function capturedTimes(banner: BannerDto, id: SlideId): string[] {
  switch (id) {
    case "message":
      return []; // a message has a date, not a snapshot time
    case "gmail":
      return banner.gmail ? [banner.gmail.capturedAt] : [];
    case "infra":
      return [banner.orphans?.capturedAt, banner.scan?.capturedAt].filter((at): at is string => at !== undefined);
    case "stocks":
      return banner.stocks ? [banner.stocks.capturedAt] : [];
  }
}

/**
 * The slide whose snapshot is oldest, with that snapshot's time ("as of HH:MM"). A slide with two
 * snapshots (orphans + scan) counts by its older one. Ties go to the earlier slide. Null when no
 * shown slide is backed by a snapshot.
 */
export function oldestSlide(banner: BannerDto, shown: readonly SlideId[]): { id: SlideId; capturedAt: string } | null {
  let oldest: { id: SlideId; capturedAt: string; ms: number } | null = null;
  for (const id of shown) {
    for (const capturedAt of capturedTimes(banner, id)) {
      const ms = Date.parse(capturedAt);
      if (Number.isNaN(ms)) continue;
      if (oldest === null || ms < oldest.ms) oldest = { id, capturedAt, ms };
    }
  }
  return oldest && { id: oldest.id, capturedAt: oldest.capturedAt };
}
