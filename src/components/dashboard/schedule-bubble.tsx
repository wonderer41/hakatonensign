import type * as React from "react";
import { Bubble } from "@/components/ui/bubble";
import { ChatIcon } from "@/components/ui/icons";
import type { AlertDto, ChecklistItemDto } from "@/types/dashboard-contracts";

export type ScheduleTarget =
  | { kind: "item"; cardId: string; cardTitle: string; item: ChecklistItemDto }
  | { kind: "alert"; alert: AlertDto };

/**
 * PLACEHOLDER so the Warnings rail typechecks. The Working-on agent builds the real Hermes
 * scheduling bubble with this exact signature; the lead replaces this file at merge time.
 */
export function ScheduleBubble({ target, onClose }: { target: ScheduleTarget; onClose: () => void }): React.JSX.Element {
  const what = target.kind === "alert" ? target.alert.title : target.item.title;
  return (
    <Bubble
      tone="hermes"
      label={`Schedule ${what} with Hermes`}
      onClose={onClose}
      // "Block time" sits at the left of an alert row; item Schedule buttons sit at the right.
      tail={target.kind === "alert" ? { side: "left", offset: 28 } : undefined}
      heading={
        <span className="flex items-center gap-2 font-mono text-[12px] tracking-[0.16em] text-lily-pink uppercase">
          <ChatIcon />
          Hermes
        </span>
      }
    >
      <p className="m-0 text-[15px] text-text">Scheduling arrives with the Hermes step.</p>
    </Bubble>
  );
}
