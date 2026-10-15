import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { GlassPanel } from "@/components/ui/glass-panel";
import { WarningIcon } from "@/components/ui/icons";
import { RailTitle } from "@/components/ui/typography";
import { localDateString } from "@/lib/time/zone";
import type { AlertDto } from "@/types/dashboard-contracts";
import { useDashboard } from "../../context";
import { ScheduleBubble } from "../../schedule-bubble";
import { blockTag } from "./format";

/** Amber panel, one row per open alert. The caller hides it when there are none. */
export function BrokenPanel({ alerts }: { alerts: AlertDto[] }) {
  const { date, now, timeZone } = useDashboard();
  // One scheduling bubble at a time across the panel. An alert that resolves while its bubble is
  // open simply stops rendering it.
  const [openId, setOpenId] = useState<string | null>(null);
  // A past day is read-only: no new blocks on it.
  const readOnly = date < localDateString(new Date(now), timeZone);

  return (
    <GlassPanel tone="broken" pad="rail" aria-label="Broken" className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2.5 text-amber">
        <WarningIcon size={18} />
        <RailTitle tone="amber">Broken</RailTitle>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {alerts.map((alert) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            open={openId === alert.id}
            readOnly={readOnly}
            tag={alert.scheduled ? blockTag(alert.scheduled, timeZone, new Date(now)) : null}
            onToggle={() => setOpenId((current) => (current === alert.id ? null : alert.id))}
            onClose={() => setOpenId(null)}
          />
        ))}
      </ul>
    </GlassPanel>
  );
}

interface AlertRowProps {
  alert: AlertDto;
  open: boolean;
  readOnly: boolean;
  /** Booked block, e.g. "19:00–20:30". */
  tag: string | null;
  onToggle: () => void;
  onClose: () => void;
}

function AlertRow({ alert, open, readOnly, tag, onToggle, onClose }: AlertRowProps) {
  const buttonId = useId();
  const close = () => {
    onClose();
    // The bubble (and whatever had focus in it) is about to unmount; keep keyboard users on the row.
    document.getElementById(buttonId)?.focus();
  };

  return (
    <li className="flex flex-col gap-3.5 border-amber/35 not-first:mt-3.5 not-first:border-t not-first:pt-3.5">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold break-words text-text-strong">{alert.title}</span>
        {alert.detail ? <span className="font-mono text-[12px] break-words text-text-muted">{alert.detail}</span> : null}
      </div>
      {readOnly && !tag ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {readOnly ? null : (
            <Button id={buttonId} variant="alert" aria-expanded={open} onClick={onToggle}>
              {tag ? "Reschedule" : "Block time"}
            </Button>
          )}
          {tag ? (
            <Chip tone="in-progress">
              <span className="sr-only">Blocked </span>
              {tag}
            </Chip>
          ) : null}
        </div>
      )}
      {open && !readOnly ? <ScheduleBubble target={{ kind: "alert", alert }} onClose={close} /> : null}
    </li>
  );
}
