import { Eyebrow } from "@/components/ui/typography";
import type { BannerDto } from "@/types/dashboard-contracts";
import { authorLabel } from "./format";

export interface DailyMessageSlideProps {
  message: NonNullable<BannerDto["dailyMessage"]>;
}

/** Slide 1: one line in Cormorant italic, signed "— Hermes" or "— you". */
export function DailyMessageSlide({ message }: DailyMessageSlideProps) {
  return (
    <figure className="banner-message">
      <Eyebrow>Daily message</Eyebrow>
      <blockquote className="banner-message__text">
        <p>{message.text}</p>
      </blockquote>
      <figcaption className="banner-message__author">{`— ${authorLabel(message.author)}`}</figcaption>
    </figure>
  );
}
