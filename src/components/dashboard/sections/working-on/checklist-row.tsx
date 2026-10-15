import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { CheckboxRow } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { ChatIcon } from "@/components/ui/icons";
import type { ChecklistItemDto, ItemProgressDto } from "@/types/dashboard-contracts";
import { ScheduleBubble } from "../../schedule-bubble";
import { issueRef, itemName, timeTag } from "./labels";
import { PushNote } from "./push-note";

/** DOM id of an item's Schedule button (focus goes back here after a bubble opened from the Hermes row). */
export function scheduleButtonId(itemId: string): string {
  return `wo-schedule-${itemId}`;
}

export interface ChecklistRowProps {
  item: ChecklistItemDto;
  cardId: string;
  cardTitle: string;
  /** Reserve the 36px issue-number column (the card has numbered items). */
  numbered: boolean;
  /** False on a past ?date= page (read-only past). */
  canSchedule: boolean;
  bubbleOpen: boolean;
  now: string;
  timeZone: string;
  onToggle: (item: ChecklistItemDto, done: boolean) => void;
  onSchedule: (itemId: string) => void;
  onCloseBubble: () => void;
  onResolveNote: (item: ChecklistItemDto, note: ItemProgressDto, action: "confirm" | "dismiss") => void;
}

/** One checklist row: checkbox (whole row is the label), number, title, time tag, Schedule, push notes, bubble. */
export function ChecklistRow(props: ChecklistRowProps) {
  const { item, cardId, cardTitle, numbered, canSchedule, bubbleOpen, now, timeZone } = props;
  const name = itemName(item);
  const showSchedule = !item.done && canSchedule;
  const rowRef = useRef<HTMLLIElement>(null);

  // A resolved push note (and the focused button in it) disappears at once: keep focus on the row.
  const resolve = (note: ItemProgressDto, action: "confirm" | "dismiss") => {
    rowRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
    props.onResolveNote(item, note, action);
  };

  return (
    <li ref={rowRef} className="flex flex-col border-b border-[rgba(216,226,220,0.14)]">
      <div className="flex flex-wrap items-center gap-2.5">
        <CheckboxRow checked={item.done} onCheckedChange={(done) => props.onToggle(item, done)} className="min-w-0 flex-[1_1_240px]">
          {numbered ? <span className="wo-num w-9 shrink-0 font-mono text-[13px]">{issueRef(item)}</span> : null}
          <span className="min-w-0 grow text-[16px] [overflow-wrap:anywhere]">{item.title}</span>
        </CheckboxRow>
        {item.scheduled ? (
          <Chip tone="in-progress">
            <span className="sr-only">Booked </span>
            {timeTag(item.scheduled, now, timeZone)}
          </Chip>
        ) : null}
        {showSchedule ? (
          <Button id={scheduleButtonId(item.id)} variant="ghost" aria-expanded={bubbleOpen} onClick={() => props.onSchedule(item.id)}>
            <ChatIcon size={15} />
            {item.scheduled ? "Reschedule" : "Schedule"}
            <span className="sr-only"> {name}</span>
          </Button>
        ) : null}
      </div>
      {item.progress.map((note) => (
        <PushNote
          key={note.id}
          note={note}
          itemName={name}
          onConfirm={() => resolve(note, "confirm")}
          onDismiss={() => resolve(note, "dismiss")}
        />
      ))}
      {bubbleOpen && showSchedule ? (
        <ScheduleBubble key={item.id} target={{ kind: "item", cardId, cardTitle, item }} onClose={props.onCloseBubble} />
      ) : null}
    </li>
  );
}
