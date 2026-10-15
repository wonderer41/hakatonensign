import "./working-on.css";
import { useEffect, useRef, useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SectionTitle } from "@/components/ui/typography";
import { localDateString } from "@/lib/time/zone";
import type { SprintDto, WorkCardDto } from "@/types/dashboard-contracts";
import { useDashboard } from "../context";
import { scheduleButtonId } from "./working-on/checklist-row";
import { sprintLine } from "./working-on/labels";
import { cardToggleId, WorkCard } from "./working-on/work-card";

export interface WorkingOnProps {
  /** The one active sprint (D8), or null. */
  activeSprint: SprintDto | null;
  /** Non-archived cards in position order, each with its checklist items. */
  cards: WorkCardDto[];
}

interface OpenBubble {
  cardId: string;
  itemId: string;
  /** Opened from the collapsed card's Hermes row, whose button is hidden once the card opens. */
  fromSuggestion: boolean;
}

/**
 * Working on: the active sprint, then one card per tracked project. One card is
 * open at a time; opening another closes the first. Checkbox writes are optimistic (mutate + PATCH
 * with the item's version); scheduling goes through the shared ScheduleBubble.
 */
export function WorkingOn({ activeSprint, cards }: WorkingOnProps) {
  const { date, now, timeZone } = useDashboard();
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [bubble, setBubble] = useState<OpenBubble | null>(null);
  const returnFocus = useRef<OpenBubble | null>(null);
  // Past days are read-only (no booking); today and future days can be scheduled.
  const canSchedule = date >= localDateString(new Date(now), timeZone);

  // After a bubble opened from the Hermes row closes, its opener is hidden (inert summary):
  // give focus to the item's Schedule button instead, or the card's title button.
  useEffect(() => {
    const target = returnFocus.current;
    if (!target) return;
    returnFocus.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    (document.getElementById(scheduleButtonId(target.itemId)) ?? document.getElementById(cardToggleId(target.cardId)))?.focus();
  });

  function toggleCard(cardId: string) {
    const opening = openCardId !== cardId;
    setOpenCardId(opening ? cardId : null);
    if (bubble && (!opening || bubble.cardId !== cardId)) setBubble(null);
  }

  function schedule(cardId: string, itemId: string, fromSuggestion: boolean) {
    if (!fromSuggestion && bubble?.itemId === itemId) {
      setBubble(null);
      return;
    }
    setOpenCardId(cardId);
    setBubble({ cardId, itemId, fromSuggestion });
  }

  function closeBubble() {
    if (bubble?.fromSuggestion) returnFocus.current = bubble;
    setBubble(null);
  }

  return (
    <GlassPanel aria-label="Working on" className="flex flex-col gap-[18px] max-sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionTitle>Working on</SectionTitle>
        <span className="font-mono text-[12px] text-text-muted">{sprintLine(activeSprint)}</span>
      </div>
      {cards.length === 0 ? (
        <p className="m-0 text-[15px] text-text-muted">No cards yet. Hermes adds one when you ask it to track something.</p>
      ) : (
        cards.map((card) => (
          <WorkCard
            key={card.id}
            card={card}
            open={openCardId === card.id}
            bubbleItemId={bubble?.cardId === card.id ? bubble.itemId : null}
            canSchedule={canSchedule}
            onToggle={() => toggleCard(card.id)}
            onSchedule={(itemId, fromSuggestion) => schedule(card.id, itemId, fromSuggestion)}
            onCloseBubble={closeBubble}
          />
        ))
      )}
    </GlassPanel>
  );
}
