import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { SeerrDecisionRequest, SeerrRequestDto } from "@/types/dashboard-contracts";
import { outcomeText, requestMeta, requestTitle, type SeerrOutcome } from "./format";

export type SeerrDecision = "approve" | "decline";
export type SeerrChoice = SeerrDecisionRequest["library"];

const LIBRARY_OPTIONS = [
  { value: "temp", label: "Temp" },
  { value: "permanent", label: "Permanent" },
] as const;

export interface SeerrRowProps {
  request: SeerrRequestDto;
  /** Set once the row is handled; the controls go and the row greys out. */
  outcome: SeerrOutcome | null;
  /** Sends the decision. Resolves with a one-line reason when the row should stay active, else null. */
  onDecide: (request: SeerrRequestDto, decision: SeerrDecision, library: SeerrChoice) => Promise<string | null>;
}

/** One pending request: title (year), type · seasons · requester, Temp | Permanent, Approve / Decline. */
export function SeerrRow({ request, outcome, onDecide }: SeerrRowProps) {
  // Guests go to Temp unless Gerardo says otherwise.
  const [library, setLibrary] = useState<SeerrChoice>("temp");
  const [busy, setBusy] = useState<SeerrDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  // The click came from this row's controls, which unmount once it is handled: move focus to the
  // status line so keyboard users stay inside the bubble (and Escape still closes it).
  const refocusRef = useRef(false);

  useEffect(() => {
    if (!outcome || !refocusRef.current) return;
    refocusRef.current = false;
    if (document.activeElement === document.body || document.activeElement === null) statusRef.current?.focus();
  }, [outcome]);

  const decide = async (decision: SeerrDecision) => {
    refocusRef.current = true;
    setBusy(decision);
    setError(null);
    const reason = await onDecide(request, decision, library);
    setBusy(null);
    setError(reason);
    if (reason) refocusRef.current = false;
  };

  const title = requestTitle(request);
  const status = outcome ? outcomeText(outcome) : error;

  return (
    <li className="flex flex-col border-t border-ink-light/20 py-3">
      <span className={cx("font-semibold break-words transition-colors duration-250", outcome ? "text-text-done" : "text-text-strong")}>
        {title}
      </span>
      <span className={cx("mt-0.5 font-mono text-[12px] break-words transition-colors duration-250", outcome ? "text-text-done" : "text-text-muted")}>
        {requestMeta(request)}
      </span>
      {outcome ? null : (
        <>
          <SegmentedControl
            label={`Library for ${title}`}
            options={LIBRARY_OPTIONS}
            value={library}
            onChange={setLibrary}
            disabled={busy !== null}
            className="mt-2 self-start"
          />
          <div className="mt-2 flex flex-wrap gap-2.5">
            <Button size="sm" disabled={busy !== null} onClick={() => void decide("approve")}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void decide("decline")}>
              {busy === "decline" ? "Declining…" : "Decline"}
            </Button>
          </div>
        </>
      )}
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className={cx("m-0 mt-2 font-mono text-[12px] empty:mt-0", outcome ? "text-text" : "text-amber")}
      >
        {status}
      </p>
    </li>
  );
}
