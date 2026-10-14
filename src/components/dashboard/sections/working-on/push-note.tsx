import { Button } from "@/components/ui/button";
import { CommitIcon, ExternalIcon } from "@/components/ui/icons";
import type { ItemProgressDto } from "@/types/dashboard-contracts";
import { shortSha } from "./labels";

export interface PushNoteProps {
  note: ItemProgressDto;
  /** "#13 Streak tracking", for the buttons' accessible names. */
  itemName: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

function CommitLink({ note }: { note: ItemProgressDto }) {
  return (
    <a
      href={note.commitUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`${note.repoFullName}@${shortSha(note.commitSha)}`}
      className="inline-flex items-center gap-1 font-mono text-[13px] text-lilac-text underline-offset-2 hover:text-lily-pink hover:underline"
    >
      {shortSha(note.commitSha)}
      <ExternalIcon size={12} />
      <span className="sr-only"> (opens GitHub in a new tab)</span>
    </a>
  );
}

/**
 * A pending push note under its checklist item (D7). looks_done asks to confirm (Confirm checks the
 * item on the server); partial is a muted one-liner. Hermes never checks an item by itself.
 */
export function PushNote({ note, itemName, onConfirm, onDismiss }: PushNoteProps) {
  if (note.kind === "looks_done") {
    return (
      <div className="mb-3 ml-8 flex flex-wrap items-center gap-x-3 gap-y-2 border border-[rgba(229,154,181,0.45)] bg-[rgba(229,154,181,0.06)] px-3 py-2 max-sm:ml-0">
        <div className="flex min-w-0 flex-[1_1_200px] items-start gap-2.5">
          <CommitIcon className="mt-0.5 shrink-0 text-lily-pink" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] text-text-strong">
              Looks done from push <CommitLink note={note} /> — confirm?
            </span>
            {note.note ? <span className="text-[13px] text-text-muted [overflow-wrap:anywhere]">{note.note}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button size="sm" onClick={onConfirm}>
            Confirm<span className="sr-only"> {itemName} is done</span>
          </Button>
          <Button variant="ghost" onClick={onDismiss}>
            Dismiss<span className="sr-only"> push note for {itemName}</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 ml-8 flex items-center gap-2.5 text-[13px] text-text-muted max-sm:ml-0">
      <CommitIcon size={14} className="shrink-0" />
      <span className="min-w-0 grow truncate" title={note.note}>
        <CommitLink note={note} /> · {note.note}
      </span>
      <Button variant="ghost" className="shrink-0 px-2.5 text-[12px]" onClick={onDismiss}>
        Dismiss<span className="sr-only"> push note for {itemName}</span>
      </Button>
    </div>
  );
}
