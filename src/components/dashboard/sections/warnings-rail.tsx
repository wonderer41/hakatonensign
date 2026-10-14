import { GlassPanel } from "@/components/ui/glass-panel";
import { WarningIcon } from "@/components/ui/icons";
import { SourceDown } from "@/components/ui/source-down";
import { RailTitle } from "@/components/ui/typography";
import type { AlertDto, TodayResponse, WaitingDto } from "@/types/dashboard-contracts";
import { useDashboard } from "../context";

export interface WarningsRailProps {
  /** Open alerts, oldest first. The Broken panel is hidden when this is empty. */
  alerts: AlertDto[];
  waiting: WaitingDto;
  /** Integration health; the rail uses `sources.seerr` (<SourceDown name="Seerr" verb="checked" …>). */
  sources: TodayResponse["sources"];
}

/**
 * STUB — the Warnings agent replaces the body (Broken + Waiting on you, Seerr bubble, orphan links;
 * see sections/README.md). Keep the export name and props.
 */
export function WarningsRail({ alerts, waiting, sources }: WarningsRailProps) {
  const { timeZone, now } = useDashboard();
  return (
    <aside aria-label="Warnings" className="flex flex-col gap-6">
      {alerts.length > 0 ? (
        <GlassPanel tone="broken" pad="rail" aria-label="Broken" className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-amber">
            <WarningIcon size={18} />
            <RailTitle tone="amber">Broken</RailTitle>
          </div>
          <p className="m-0 text-[15px] text-text">
            Placeholder · {alerts.length} open {alerts.length === 1 ? "alert" : "alerts"}
          </p>
        </GlassPanel>
      ) : null}
      <GlassPanel pad="rail" aria-label="Waiting on you" className="flex flex-col gap-3">
        <RailTitle>Waiting on you</RailTitle>
        <p className="m-0 text-[15px] text-text">
          Placeholder · gmail {waiting.gmailNeedsReply} · seerr {waiting.seerrPending ?? "?"} · orphans {waiting.orphans.sonarr}/
          {waiting.orphans.radarr}
        </p>
        <SourceDown name="Seerr" verb="checked" source={sources.seerr} timeZone={timeZone} now={now} />
      </GlassPanel>
    </aside>
  );
}
