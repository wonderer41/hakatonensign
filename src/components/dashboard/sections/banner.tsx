import { GlassPanel } from "@/components/ui/glass-panel";
import { Eyebrow } from "@/components/ui/typography";
import type { BannerDto } from "@/types/dashboard-contracts";

export interface BannerProps {
  banner: BannerDto;
}

/**
 * STUB — the banner agent replaces the body (slides: daily message → Gmail → orphans + scan →
 * stocks; see sections/README.md). Keep the export name and props.
 */
export function Banner({ banner }: BannerProps) {
  const slides = [
    banner.dailyMessage ? "daily message" : null,
    banner.gmail ? "gmail" : null,
    banner.orphans || banner.scan ? "orphans + scan" : null,
    banner.stocks ? "stocks" : null,
  ].filter((slide): slide is string => slide !== null);

  return (
    <GlassPanel aria-label="Daily banner" pad="none">
      <div className="flex flex-col gap-1.5 px-7 pt-6 pb-11">
        <Eyebrow>Daily banner</Eyebrow>
        <p className="m-0 text-[15px] text-text">
          Placeholder · slides with data: {slides.length > 0 ? slides.join(" · ") : "none"}
        </p>
      </div>
    </GlassPanel>
  );
}
