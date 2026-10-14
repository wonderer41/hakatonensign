import { useCallback, useEffect, useReducer, useRef } from "react";
import { Bubble } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { ExternalIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow } from "@/components/ui/typography";
import type { SeerrDecisionRequest, SeerrDecisionResponse, SeerrRequestDto } from "@/types/dashboard-contracts";
import { fetchJson } from "../../api";
import { useDashboard, useLiveEvent } from "../../context";
import {
  decisionFailure,
  initialSeerrList,
  moreInSeerr,
  requestErrorText,
  seerrListReducer,
  type SeerrOutcome,
  withSeerrPendingAtMost,
} from "./format";
import { SeerrRow, type SeerrChoice, type SeerrDecision } from "./seerr-row";

export interface SeerrBubbleProps {
  /** The Waiting count (null while Seerr is down). */
  count: number | null;
  /** "Open Seerr ↗" (SEERR_PUBLIC_URL); the link is left out when it is not set. */
  seerrUrl: string | null;
  onClose: () => void;
}

/**
 * The pending Seerr requests. Loads GET /api/seerr/requests when it opens and again on every
 * `seerr.changed`; rows handled here stay listed, greyed, until the bubble closes.
 */
export function SeerrBubble({ count, seerrUrl, onClose }: SeerrBubbleProps) {
  const { mutate } = useDashboard();
  const [state, dispatch] = useReducer(seerrListReducer, initialSeerrList);
  // Only the newest load may land; an older answer arriving late is dropped.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    loadSeq.current += 1;
    const seq = loadSeq.current;
    try {
      const { data } = await fetchJson<{ data: SeerrRequestDto[] }>("/api/seerr/requests");
      if (seq === loadSeq.current) dispatch({ type: "loaded", requests: data });
    } catch (error) {
      if (seq === loadSeq.current) dispatch({ type: "failed", message: requestErrorText(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveEvent((event) => {
    if (event.type === "seerr.changed") void load();
  });

  const settle = (id: number, outcome: SeerrOutcome) => dispatch({ type: "handled", id, outcome });

  const decide = async (request: SeerrRequestDto, decision: SeerrDecision, library: SeerrChoice): Promise<string | null> => {
    // The count drops while the request runs (back up if it fails); set-to-at-most, so a live
    // refresh that already counted it can't drop it twice.
    const target = count === null ? null : Math.max(0, count - 1);
    try {
      await mutate(
        (today) => (target === null ? today : withSeerrPendingAtMost(today, target)),
        async () => {
          if (decision === "approve") {
            const body: SeerrDecisionRequest = { library };
            const result = await fetchJson<SeerrDecisionResponse>(`/api/seerr/requests/${request.id}/approve`, { method: "POST", json: body });
            // Anime ignores the switch: show the library Seerr really used.
            settle(request.id, { kind: "approved", library: result.library });
          } else {
            await fetchJson<{ ok: true }>(`/api/seerr/requests/${request.id}/decline`, { method: "POST" });
            settle(request.id, { kind: "declined" });
          }
        },
      );
      return null;
    } catch (error) {
      const failure = decisionFailure(error);
      if ("retry" in failure) return failure.retry;
      // Approved/declined in Seerr itself, or deleted there: grey the row and resync the list.
      settle(request.id, failure.settled);
      void load();
      return null;
    }
  };

  const handled = state.rows.filter((request) => state.outcomes[request.id]).length;
  const pendingShown = state.rows.length - handled;
  const more = state.phase === "ready" ? moreInSeerr(count, pendingShown) : null;

  return (
    <Bubble
      tone="seerr"
      label="Seerr requests"
      closeLabel="Close Seerr requests"
      onClose={onClose}
      heading={
        <Eyebrow as="span" tone="reflection" className="tracking-[0.14em]">
          Pending requests
        </Eyebrow>
      }
      className="gap-0"
    >
      <div className="mt-2 flex flex-col">
        {state.phase === "loading" ? (
          <div aria-busy="true" className="flex flex-col gap-2.5 border-t border-ink-light/20 py-3">
            <span className="sr-only">Loading requests…</span>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-9 w-44" />
          </div>
        ) : state.rows.length > 0 ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {state.rows.map((request) => (
              <SeerrRow key={request.id} request={request} outcome={state.outcomes[request.id] ?? null} onDecide={decide} />
            ))}
          </ul>
        ) : state.error ? null : (
          <p className="m-0 border-t border-ink-light/20 py-3 text-[13px] text-text-muted">No requests waiting.</p>
        )}
        {more !== null ? <p className="m-0 border-t border-ink-light/20 py-3 text-[13px] text-text-muted">+ {more} more in Seerr</p> : null}
        {state.error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-ink-light/20 py-3">
            <span className="text-[13px] text-amber">{state.error}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
        {seerrUrl ? (
          <div className="border-t border-ink-light/20">
            <a
              href={seerrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="-mb-1.5 inline-flex min-h-11 items-center gap-1.5 text-[13px] text-lilac-text hover:text-lily-pink"
            >
              Open Seerr
              <ExternalIcon size={14} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        ) : null}
      </div>
    </Bubble>
  );
}
