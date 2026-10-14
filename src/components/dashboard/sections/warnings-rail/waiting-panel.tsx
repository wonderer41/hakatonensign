import { useId, useState, type KeyboardEvent } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { ExternalIcon } from "@/components/ui/icons";
import { InnerCard } from "@/components/ui/inner-card";
import { SourceDown } from "@/components/ui/source-down";
import { RailTitle } from "@/components/ui/typography";
import type { SourceStateDto, WaitingDto } from "@/types/dashboard-contracts";
import { useDashboard } from "../../context";
import { countLabel, gmailLine, seerrSummary, waitingVisibility } from "./format";
import { SeerrBubble } from "./seerr-bubble";

export interface WaitingPanelProps {
  waiting: WaitingDto;
  /** sources.seerr: when it is down the Seerr item says so and its count reads "?". */
  seerr: SourceStateDto;
}

/** "Waiting on you": Gmail, Seerr (with the approve bubble) and orphan review. Items hide at zero. */
export function WaitingPanel({ waiting, seerr }: WaitingPanelProps) {
  const [seerrOpen, setSeerrOpen] = useState(false);
  const visible = waitingVisibility(waiting, seerr.ok, seerrOpen);

  return (
    <GlassPanel pad="rail" aria-label="Waiting on you" className="flex flex-col gap-3">
      <RailTitle>Waiting on you</RailTitle>
      {visible.gmail ? (
        <InnerCard accent="gmail" className="flex flex-col gap-1 px-3.5 py-3">
          <span className="font-semibold text-text-strong">Gmail</span>
          <span className="text-[13px] text-text-muted">{gmailLine(waiting.gmailNeedsReply)}</span>
        </InnerCard>
      ) : null}
      {visible.seerr ? (
        <SeerrItem count={waiting.seerrPending} source={seerr} seerrUrl={waiting.seerrUrl} open={seerrOpen} onOpenChange={setSeerrOpen} />
      ) : null}
      {visible.orphans ? <OrphanReview orphans={waiting.orphans} /> : null}
      {visible.nothing ? <p className="m-0 text-[15px] text-text-muted">Nothing waiting.</p> : null}
    </GlassPanel>
  );
}

interface SeerrItemProps {
  count: number | null;
  source: SourceStateDto;
  seerrUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The Seerr button card; it opens the bubble with the pending requests right under it. */
function SeerrItem({ count, source, seerrUrl, open, onOpenChange }: SeerrItemProps) {
  const { now, timeZone } = useDashboard();
  const toggleId = useId();
  const bubbleId = useId();

  const close = () => {
    onOpenChange(false);
    // Focus was probably inside the bubble, which is about to unmount.
    document.getElementById(toggleId)?.focus();
  };
  const onToggleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <div className="flex flex-col">
      <InnerCard accent="seerr" className="flex flex-col">
        <button
          id={toggleId}
          type="button"
          aria-expanded={open}
          aria-controls={open ? bubbleId : undefined}
          onClick={() => onOpenChange(!open)}
          onKeyDown={onToggleKeyDown}
          className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left hover:bg-[rgba(8,18,22,0.25)]"
        >
          <span className="flex grow flex-col gap-1">
            <span className="font-semibold text-text-strong">Seerr</span>
            <span className="text-[13px] text-text-muted">{seerrSummary(count)}</span>
          </span>
          <span className="shrink-0 text-[13px] text-reflection">{open ? "Close" : count === 0 ? "" : "Review"}</span>
        </button>
        <SourceDown name="Seerr" verb="checked" source={source} timeZone={timeZone} now={now} className="-mt-1 px-3.5 pb-3" />
      </InnerCard>
      {open ? (
        <div id={bubbleId} className="mt-3">
          <SeerrBubble count={count} seerrUrl={seerrUrl} onClose={close} />
        </div>
      ) : null}
    </div>
  );
}

/** Two link tiles, Sonarr ↗ (episodes) and Radarr ↗ (movies). A tile with no URL is a muted line instead. */
function OrphanReview({ orphans }: { orphans: WaitingDto["orphans"] }) {
  const tiles = [
    { name: "Sonarr", env: "SONARR_URL", url: orphans.sonarrUrl, label: countLabel(orphans.sonarr, "episode", "episodes"), count: orphans.sonarr },
    { name: "Radarr", env: "RADARR_URL", url: orphans.radarrUrl, label: countLabel(orphans.radarr, "movie", "movies"), count: orphans.radarr },
  ].filter((tile) => tile.count > 0);
  const linked = tiles.filter((tile) => tile.url !== null);
  const unlinked = tiles.filter((tile) => tile.url === null);

  return (
    <InnerCard accent="pipeline" className="flex min-w-0 flex-col gap-2.5 px-3.5 py-3">
      <span className="font-semibold text-text-strong">Orphan review</span>
      {linked.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(120px,100%),1fr))] gap-2">
          {linked.map((tile) => (
            <a
              key={tile.name}
              href={tile.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 flex-col gap-0.5 border border-ink-light/40 px-2.5 py-2 text-text-strong no-underline transition-colors duration-200 hover:border-ink-light hover:bg-[rgba(8,18,22,0.35)]"
            >
              <span className="flex items-center justify-between gap-1.5 font-semibold">
                {tile.name}
                <ExternalIcon size={14} className="text-lilac-text" />
              </span>
              <span className="font-mono text-[12px] text-text-muted">{tile.label}</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ))}
        </div>
      ) : null}
      {unlinked.map((tile) => (
        <p key={tile.name} className="m-0 text-[13px] text-text-muted">
          {tile.name} · {tile.label} — no link ({tile.env} is not set)
        </p>
      ))}
    </InnerCard>
  );
}
