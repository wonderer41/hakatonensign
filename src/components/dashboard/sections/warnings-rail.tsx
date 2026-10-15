import type { AlertDto, TodayResponse, WaitingDto } from "@/types/dashboard-contracts";
import { BrokenPanel } from "./warnings-rail/broken-panel";
import { WaitingPanel } from "./warnings-rail/waiting-panel";

export interface WarningsRailProps {
  /** Open alerts, oldest first. The Broken panel is hidden when this is empty. */
  alerts: AlertDto[];
  waiting: WaitingDto;
  /** Integration health; the rail uses `sources.seerr` (<SourceDown name="Seerr" verb="checked" …>). */
  sources: TodayResponse["sources"];
}

/**
 * Warnings (1/3 column): the amber Broken panel (open alerts, "Block time" → Hermes scheduling
 * bubble) and Waiting on you (Gmail, Seerr approvals, orphan review).
 */
export function WarningsRail({ alerts, waiting, sources }: WarningsRailProps) {
  return (
    <aside aria-label="Warnings" className="flex flex-col gap-6 text-[15px] leading-normal">
      {alerts.length > 0 ? <BrokenPanel alerts={alerts} /> : null}
      <WaitingPanel waiting={waiting} seerr={sources.seerr} />
    </aside>
  );
}
