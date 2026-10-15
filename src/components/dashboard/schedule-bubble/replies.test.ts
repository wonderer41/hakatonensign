import assert from "node:assert/strict";
import { test } from "node:test";
import type { AlertDto, ChecklistItemDto, ScheduleRequestDto } from "@/types/dashboard-contracts";
import type { ScheduleTarget } from "../schedule-bubble";
import { questionText, replyFor, shortSubject } from "./replies";

const zone = "America/Denver";
const date = "2026-10-14";

const item: ChecklistItemDto = {
  id: "item-13",
  cardId: "card-1",
  externalKey: null,
  title: "Streak tracking",
  issueNumber: 13,
  sourceUrl: null,
  done: false,
  doneAt: null,
  isCurrent: false,
  position: 7000,
  createdBy: "user",
  version: 1,
  scheduled: null,
  progress: [],
};

const alert: AlertDto = {
  id: "alert-1",
  dedupeKey: "proxmox:vzdump:vm100",
  source: "proxmox",
  title: "VM 100 backup missed",
  detail: "vzdump · Sun 01:00",
  severity: "warning",
  openedAt: "2026-10-12T15:00:00Z",
  resolvedAt: null,
  scheduled: null,
};

const itemTarget: ScheduleTarget = { kind: "item", cardId: "card-1", cardTitle: "study-sessions", item };
const alertTarget: ScheduleTarget = { kind: "alert", alert };

function dto(partial: Partial<ScheduleRequestDto>): ScheduleRequestDto {
  return {
    id: "req-1",
    status: "checking",
    checklistItemId: item.id,
    alertId: null,
    requestedStart: "2026-10-14T22:00:00Z", // 16:00 MDT
    durationMin: 90,
    conflict: null,
    suggestedStart: null,
    booked: null,
    transcript: [],
    error: null,
    ...partial,
  };
}

const context = { subject: "#13", date, timeZone: zone };

test("questions name the item or the alert", () => {
  assert.equal(questionText(itemTarget), "When should I block time for #13 Streak tracking?");
  assert.equal(questionText({ ...itemTarget, item: { ...item, issueNumber: null } }), "When should I block time for Streak tracking?");
  assert.equal(questionText(alertTarget), "When should I block time for Fix · VM 100 backup missed?");
  assert.equal(shortSubject(itemTarget), "#13");
  assert.equal(shortSubject(alertTarget), "Fix · VM 100 backup missed");
});

test("checking shows no text yet", () => {
  assert.deepEqual(replyFor(dto({}), context), { phase: "checking", text: "", suggestion: null });
});

test("booked", () => {
  const view = replyFor(
    dto({ status: "booked", booked: { calendarEventId: "ev", startsAt: "2026-10-15T01:00:00Z", endsAt: "2026-10-15T02:30:00Z" } }),
    context,
  );
  assert.deepEqual(view, { phase: "booked", text: "Done. #13 is on your calendar 19:00–20:30.", suggestion: null });
});

test("conflict with the server's suggestion (spec text)", () => {
  const view = replyFor(
    dto({
      status: "conflict",
      conflict: { eventId: "ev", title: "[Work shift]", startsAt: "2026-10-14T21:30:00Z", endsAt: "2026-10-15T00:30:00Z" },
      suggestedStart: "2026-10-15T02:30:00Z",
    }),
    context,
  );
  assert.deepEqual(view, {
    phase: "conflict",
    text: "I can't book that: [Work shift] is on your calendar 15:30–18:30. The next free 1 h 30 min starts at 20:30.",
    suggestion: "20:30",
  });
});

test("conflict without a suggestion falls back to the page's calendar, counting the conflict itself", () => {
  const conflict = { eventId: "ev", title: "[Work shift]", startsAt: "2026-10-14T21:30:00Z", endsAt: "2026-10-15T00:30:00Z" };
  // The page's copy doesn't know the shift yet; only the evening block.
  const view = replyFor(dto({ status: "conflict", conflict }), { ...context, busy: [{ start: 1140, end: 1230 }] });
  assert.equal(view.suggestion, "20:30");
  const none = replyFor(dto({ status: "conflict", conflict, durationMin: 400 }), { ...context, busy: [] });
  assert.equal(none.suggestion, null);
  assert.equal(none.text, "I can't book that: [Work shift] is on your calendar 15:30–18:30. There is no free 6 h 40 min left today.");
});

test("failed shows the server's reason, or the no-answer line", () => {
  assert.deepEqual(replyFor(dto({ status: "failed", error: "That runs past midnight. Try an earlier start." }), context), {
    phase: "failed",
    text: "That runs past midnight. Try an earlier start.",
    suggestion: null,
  });
  assert.equal(replyFor(dto({ status: "failed" }), context).text, "Hermes didn't answer. Try again.");
});
