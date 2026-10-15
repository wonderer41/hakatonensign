import type * as React from "react";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { Bubble } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { ChatIcon } from "@/components/ui/icons";
import { Field, NumberInput, TimeInput } from "@/components/ui/inputs";
import { localDateString } from "@/lib/time/zone";
import type { AlertDto, ChecklistItemDto, ScheduleRequestBody, ScheduleRequestDto } from "@/types/dashboard-contracts";
import { fetchJson, isAbortError, isApiRequestError } from "./api";
import { useDashboard, useLiveEvent } from "./context";
import { busyRanges } from "./schedule-bubble/find-free";
import { formatDuration, parseLength, wallMinutes } from "./schedule-bubble/format";
import { questionText, replyFor, shortSubject, type ReplyPhase } from "./schedule-bubble/replies";
import { checkDraft, defaultLength, defaultStart, draftEcho, MESSAGES, type DayState } from "./schedule-bubble/validate";

/** What the bubble books time for: a checklist item (Working on) or an open alert (Broken). */
export type ScheduleTarget =
  | { kind: "item"; cardId: string; cardTitle: string; item: ChecklistItemDto }
  | { kind: "alert"; alert: AlertDto };

type Phase = "ask" | ReplyPhase;

interface Message {
  id: number;
  who: "hermes" | "me";
  text: string;
}

/** Fallback check while a request is "checking", in case a schedule.updated event was missed. */
const POLL_MS = 10_000;
/** The server gives up after 120 s; the bubble a little later. */
const GIVE_UP_MS = 150_000;

function minutesBetween(startsAt: string, endsAt: string): number {
  return Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
}

/**
 * The Hermes scheduling bubble: Hermes asks when to block time, Gerardo picks a
 * start and any length (1–720 min), and the reply comes back from POST /api/schedule — booked,
 * conflict (with a one-click `Use HH:MM`), or failed. Local checks run first. Esc or × closes it;
 * focus moves to the start field on open and back to the opener on close.
 */
export function ScheduleBubble({ target, onClose }: { target: ScheduleTarget; onClose: () => void }): React.JSX.Element {
  const { date, now, timeZone, today, refresh } = useDashboard();
  const todayLocal = localDateString(new Date(now), timeZone);
  const day: DayState = date < todayLocal ? "past" : date > todayLocal ? "future" : "today";
  const nowMin = wallMinutes(now, todayLocal, timeZone);
  const scheduled = target.kind === "item" ? target.item.scheduled : target.alert.scheduled;
  const subject = shortSubject(target);

  const [start, setStart] = useState(() =>
    defaultStart(day, nowMin, scheduled && localDateString(new Date(scheduled.startsAt), timeZone) === date ? wallMinutes(scheduled.startsAt, date, timeZone) : null),
  );
  const [length, setLength] = useState(() => defaultLength(scheduled ? minutesBetween(scheduled.startsAt, scheduled.endsAt) : null));
  const [invalid, setInvalid] = useState<"start" | "length" | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState<Phase>("ask");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  /** The request the bubble is waiting on (also read on close, to cancel it). */
  const pendingRef = useRef<string | null>(null);
  const pollingRef = useRef(false);
  const messageSeq = useRef(0);

  // Open: remember the opener, focus Start. Close: abort, cancel a pending request, give focus back
  // when it would otherwise fall to <body> (not when Gerardo clicked something else meanwhile).
  useEffect(() => {
    if (!openerRef.current) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    const opener = openerRef.current;
    const pending = pendingRef;
    const controller = controllerRef;
    rootRef.current?.querySelector<HTMLInputElement>('input[type="time"]')?.focus();
    return () => {
      controller.current?.abort();
      const id = pending.current;
      if (id) {
        pending.current = null;
        void fetchJson(`/api/schedule/${encodeURIComponent(id)}/cancel`, { method: "POST" }).catch(() => undefined);
      }
      const active = document.activeElement;
      if (opener?.isConnected && (!active || active === document.body)) opener.focus({ preventScroll: true });
    };
  }, []);

  function say(...next: Omit<Message, "id">[]) {
    const stamped = next.map((message) => {
      messageSeq.current += 1;
      return { ...message, id: messageSeq.current };
    });
    setMessages((current) => [...current, ...stamped]);
  }

  function apply(dto: ScheduleRequestDto) {
    if (pendingRef.current !== null && dto.id !== pendingRef.current) return;
    const busy =
      today.timeline.date === date
        ? busyRanges(today.timeline.events, date, timeZone, target.kind === "item" ? { checklistItemId: target.item.id } : { alertId: target.alert.id })
        : undefined;
    const view = replyFor(dto, { subject, date, timeZone, busy });
    if (view.phase === "checking") {
      pendingRef.current = dto.id;
      setRequestId(dto.id);
      setPhase("checking");
      return;
    }
    pendingRef.current = null;
    setRequestId(null);
    setPhase(view.phase);
    setSuggestion(view.suggestion);
    say({ who: "hermes", text: view.text });
    if (view.phase === "booked") void refresh();
  }

  function noAnswer() {
    pendingRef.current = null;
    setRequestId(null);
    setPhase("failed");
    say({ who: "hermes", text: MESSAGES.noAnswer });
  }

  async function poll(id: string) {
    if (pollingRef.current || pendingRef.current !== id) return;
    pollingRef.current = true;
    try {
      const dto = await fetchJson<ScheduleRequestDto>(`/api/schedule/${encodeURIComponent(id)}`, { signal: controllerRef.current?.signal });
      if (pendingRef.current === id) apply(dto);
    } catch {
      // Keep waiting: the next event, the fallback poll or the give-up timer settles it.
    } finally {
      pollingRef.current = false;
    }
  }

  useLiveEvent((event) => {
    if (event.type === "schedule.updated" && event.scheduleId === pendingRef.current) void poll(event.scheduleId);
  });

  const onPollTick = useEffectEvent((id: string) => void poll(id));
  // Covers a POST that never answers as well as a request that stays "checking".
  const onGiveUp = useEffectEvent(() => {
    controllerRef.current?.abort();
    const id = pendingRef.current;
    if (id) void fetchJson(`/api/schedule/${encodeURIComponent(id)}/cancel`, { method: "POST" }).catch(() => undefined);
    noAnswer();
  });
  useEffect(() => {
    if (phase !== "checking") return;
    const interval = requestId ? setInterval(() => onPollTick(requestId), POLL_MS) : undefined;
    const giveUp = setTimeout(() => onGiveUp(), GIVE_UP_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(giveUp);
    };
  }, [phase, requestId]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "checking") return;
    const draft = { start, length };
    const mine = { who: "me" as const, text: draftEcho(draft) };
    const check = checkDraft(draft, day, nowMin);
    if (!check.ok) {
      setInvalid(check.field);
      setSuggestion(null);
      setPhase("ask");
      say(mine, { who: "hermes", text: check.message });
      return;
    }

    // The form hides while Hermes works; keep focus inside the bubble so Esc still closes it.
    if (formRef.current?.contains(document.activeElement)) logRef.current?.focus({ preventScroll: true });
    setInvalid(null);
    setSuggestion(null);
    setPhase("checking");
    say(mine);

    const body: ScheduleRequestBody = {
      ...(target.kind === "item" ? { checklistItemId: target.item.id } : { alertId: target.alert.id }),
      start: check.start,
      date,
      durationMin: check.durationMin,
    };
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const dto = await fetchJson<ScheduleRequestDto>("/api/schedule", { method: "POST", json: body, signal: controller.signal });
      pendingRef.current = null;
      apply(dto);
    } catch (error) {
      if (isAbortError(error)) return;
      // A plain 404 means the scheduling route itself is not there yet (Phase 5), not a Hermes failure.
      if (isApiRequestError(error, "HTTP_ERROR") && error.status === 404) {
        pendingRef.current = null;
        setRequestId(null);
        setPhase("failed");
        say({ who: "hermes", text: MESSAGES.notConnected });
        return;
      }
      noAnswer();
    }
  }

  const showForm = phase !== "checking" && phase !== "booked";
  const lengthEcho = formatDuration(parseLength(length));
  const isItem = target.kind === "item";
  const label = isItem ? `Schedule with Hermes · ${target.cardTitle} ${subject}` : `Schedule with Hermes · ${subject}`;

  return (
    <div ref={rootRef} className={cx(isItem ? "mt-1.5 mb-4 ml-auto w-[min(480px,100%)]" : "mt-3 w-full")}>
      <Bubble
        tone="hermes"
        label={label}
        closeLabel="Close chat"
        onClose={onClose}
        tail={isItem ? { side: "right", offset: 44 } : { side: "left", offset: 28 }}
        heading={
          <span className="flex items-center gap-2 font-semibold text-lily-pink">
            <ChatIcon />
            Hermes <span className="font-mono text-[12px] font-normal text-text-muted">· calendar</span>
          </span>
        }
      >
        {/* Focus parks here while the form is hidden (Esc keeps working); it is not a control, so no ring. */}
        <div ref={logRef} role="log" aria-live="polite" tabIndex={-1} className="flex flex-col gap-2" style={{ outline: "none" }}>
          {[{ id: 0, who: "hermes" as const, text: questionText(target) }, ...messages].map((message) => (
            <div key={message.id} className={cx("flex", message.who === "me" ? "justify-end" : "justify-start")}>
              <p
                className={cx(
                  "m-0 max-w-[86%] px-3 py-2.5 text-[15px] leading-[1.4] text-pretty",
                  message.who === "me"
                    ? "bg-lilac text-on-lilac"
                    : "border border-[rgba(229,154,181,0.55)] bg-[rgba(229,154,181,0.1)] text-text-strong",
                )}
              >
                {message.who === "me" ? <span className="sr-only">You: </span> : <span className="sr-only">Hermes: </span>}
                {message.text}
              </p>
            </div>
          ))}
          {phase === "checking" ? <p className="m-0 text-[14px] text-text-muted italic">{MESSAGES.checking}</p> : null}
        </div>

        {phase === "conflict" && suggestion ? (
          <button
            type="button"
            onClick={() => {
              setStart(suggestion);
              setInvalid(null);
            }}
            className="min-h-11 cursor-pointer self-start border border-dashed border-lilac bg-[rgba(156,143,208,0.1)] px-3.5 text-[14px] text-lilac-text"
          >
            Use {suggestion}
          </button>
        ) : null}

        {showForm ? (
          <form
            ref={formRef}
            noValidate
            onSubmit={(event) => void ask(event)}
            className="flex flex-wrap items-end gap-2.5 border-t border-[rgba(216,226,220,0.2)] pt-1"
          >
            <Field label="Start">
              <TimeInput
                name="start"
                value={start}
                aria-invalid={invalid === "start" || undefined}
                onChange={(event) => {
                  setStart(event.target.value);
                  if (invalid === "start") setInvalid(null);
                }}
              />
            </Field>
            <Field label="Length · min">
              <span className="flex items-center gap-2">
                <NumberInput
                  name="length"
                  min={1}
                  max={720}
                  step={1}
                  value={length}
                  aria-invalid={invalid === "length" || undefined}
                  className="w-[88px]"
                  onChange={(event) => {
                    setLength(event.target.value);
                    if (invalid === "length") setInvalid(null);
                  }}
                />
                <span className="min-w-[9ch] text-[12px] tracking-normal text-text normal-case">
                  {lengthEcho}
                </span>
              </span>
            </Field>
            <Button type="submit" variant="primary">
              Ask Hermes
            </Button>
          </form>
        ) : null}
      </Bubble>
    </div>
  );
}
