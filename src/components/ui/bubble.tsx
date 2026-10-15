import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";
import { CloseIcon } from "./icons";

export interface BubbleProps {
  /** hermes = lilac border + lilac hard shadow; seerr = #E8C77A border + gold hard shadow. */
  tone: "hermes" | "seerr";
  /** Accessible name of the group, e.g. "Schedule with Hermes" or "Seerr requests". */
  label: string;
  /** Header row content (left side). The close button, when given, sits on the right. */
  heading?: ReactNode;
  /** Shows a 44×44 close (×) button and closes on Escape while focus is inside. */
  onClose?: () => void;
  /** Accessible name of the close button. Default "Close". */
  closeLabel?: string;
  /** Which edge of the top border the tail sits near, and how far in (px). Hermes: right 44; Seerr: left 28. */
  tail?: { side: "left" | "right"; offset: number } | null;
  className?: string;
  children: ReactNode;
}

const DEFAULT_TAIL = {
  hermes: { side: "right", offset: 44 },
  seerr: { side: "left", offset: 28 },
} as const;

/**
 * The chat / Seerr bubble: near-opaque glass, sharp corners, hard offset
 * shadow and a 16px square rotated 45° as the tail. Width and margins are the caller's
 * (the Hermes bubble is `ml-auto w-[min(480px,100%)]`, the Seerr one `mt-3`).
 */
export function Bubble({ tone, label, heading, onClose, closeLabel = "Close", tail, className, children }: BubbleProps) {
  const tailPosition = tail === undefined ? DEFAULT_TAIL[tone] : tail;
  const onKeyDown = onClose
    ? (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }
    : undefined;

  return (
    <div role="group" aria-label={label} className={cx("bubble", `bubble--${tone}`, className)} onKeyDown={onKeyDown}>
      {tailPosition ? <span aria-hidden="true" className="bubble__tail" style={{ [tailPosition.side]: tailPosition.offset }} /> : null}
      {heading !== undefined || onClose ? (
        <div className="flex items-center justify-between gap-2.5">
          <div className="min-w-0 grow">{heading}</div>
          {onClose ? (
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              className="-my-2.5 -mr-2.5 flex size-11 shrink-0 cursor-pointer items-center justify-center text-text"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
