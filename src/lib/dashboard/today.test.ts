import assert from "node:assert/strict";
import test from "node:test";
import type { Sprint } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import type { TimelineResponse } from "@/types/dashboard-contracts";
import type { AlertRow, CardRow } from "./dto";
import { assembleToday, CALENDAR_STALE_MS, calendarSource, checkSeerrCount, linkFromEnv, type SnapshotRow, type TodayParts } from "./today";

const NOW = new Date("2026-10-14T17:45:00.000Z"); // 11:45 in Denver
const AT = new Date("2026-10-10T12:00:00.000Z");

function timeline(overrides: Partial<TimelineResponse> = {}): TimelineResponse {
  return {
    date: "2026-10-14",
    timeZone: "America/Denver",
    now: NOW.toISOString(),
    allDay: [],
    events: [],
    gaps: [],
    lastSyncAt: new Date(NOW.getTime() - 60_000).toISOString(),
    syncError: null,
    ...overrides,
  };
}

const sprint: Sprint = {
  id: "sprint-1",
  externalKey: null,
  name: "Week 42",
  goal: null,
  startsOn: new Date("2026-10-12T00:00:00Z"),
  endsOn: new Date("2026-10-18T00:00:00Z"),
  status: "active",
  createdBy: "user",
  version: 1,
  createdAt: AT,
  updatedAt: AT,
};

function item(id: string, position: number, done: boolean, isCurrent = false): CardRow["items"][number] {
  return {
    id,
    cardId: "card-1",
    externalKey: null,
    title: `Item ${id}`,
    issueNumber: null,
    sourceUrl: null,
    done,
    doneAt: done ? AT : null,
    isCurrent,
    position,
    createdBy: "user",
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    calendarEvents: [],
    progress: [],
  };
}

function card(id: string, position: number, items: CardRow["items"]): CardRow {
  return {
    id,
    externalKey: null,
    title: `Card ${id}`,
    repoFullName: null,
    milestoneTitle: null,
    sprintId: sprint.id,
    projectId: null,
    status: "active",
    position,
    createdBy: "user",
    hermesSuggestion: null,
    lastActivityAt: null,
    meta: {},
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    items,
  };
}

const alert: AlertRow = {
  id: "alert-1",
  dedupeKey: "proxmox:vzdump:vm100",
  source: "proxmox",
  title: "VM 100 backup missed",
  detail: "vzdump · Sun 01:00",
  severity: "warning",
  openedAt: AT,
  resolvedAt: null,
  meta: {},
  updatedAt: AT,
  calendarEvents: [],
};

const gmail: SnapshotRow = {
  kind: "gmail",
  capturedAt: AT,
  payload: {
    since: "2026-10-14T14:00:00Z",
    needsReply: [{ from: "Sender", subject: "Subject" }],
    packages: [],
    payments: [],
    deletedCount: 4,
  },
};

const orphans: SnapshotRow = {
  kind: "orphans",
  capturedAt: AT,
  payload: { items: [{ name: "Show S01E04", kind: "episode", arr: "sonarr" }], counts: { sonarr: 5, radarr: 1 } },
};

function parts(overrides: Partial<TodayParts> = {}): TodayParts {
  return {
    date: "2026-10-14",
    timeZone: "America/Denver",
    now: NOW,
    timeline: timeline(),
    activeSprint: sprint,
    cards: [card("card-1", 1000, [item("b", 2000, false, true), item("a", 1000, true)]), card("card-2", 2000, [])],
    alerts: [alert],
    snapshots: [gmail, orphans],
    dailyMessage: { date: new Date("2026-10-14T00:00:00Z"), text: "Go slow.", author: "hermes", updatedAt: AT },
    seerr: { count: 2, source: { ok: true, lastSyncAt: NOW.toISOString(), error: null } },
    links: { sonarrUrl: "https://sonarr.example.com", radarrUrl: null, seerrUrl: "https://requests.example.com" },
    ...overrides,
  };
}

test("today: assembles banner, working-on, warnings and sources from what was read", () => {
  const today = assembleToday(parts());
  assert.equal(today.date, "2026-10-14");
  assert.equal(today.generatedAt, NOW.toISOString());
  assert.deepEqual(today.banner.dailyMessage, { date: "2026-10-14", text: "Go slow.", author: "hermes" });
  assert.equal(today.banner.gmail?.data.deletedCount, 4);
  assert.equal(today.banner.scan, null);
  assert.equal(today.banner.stocks, null);

  assert.equal(today.workingOn.activeSprint?.daysLeft, 4);
  assert.deepEqual(today.workingOn.cards.map((c) => c.id), ["card-1", "card-2"]);
  const first = today.workingOn.cards[0];
  assert.deepEqual(first.items.map((i) => i.id), ["a", "b"]);
  assert.deepEqual(first.progress, { done: 1, total: 2 });
  assert.deepEqual(first.current, { itemId: "b", label: "now" });

  assert.deepEqual(today.warnings.alerts.map((a) => a.title), ["VM 100 backup missed"]);
  assert.deepEqual(today.warnings.waiting, {
    gmailNeedsReply: 1,
    seerrPending: 2,
    orphans: { sonarr: 5, radarr: 1, sonarrUrl: "https://sonarr.example.com", radarrUrl: null },
    seerrUrl: "https://requests.example.com",
  });
  assert.deepEqual(today.sources.calendar, { ok: true, lastSyncAt: today.timeline.lastSyncAt, error: null });
  assert.equal(today.sources.seerr.ok, true);
});

test("today: missing or malformed snapshots hide their slide and count as zero", () => {
  const broken: SnapshotRow = { ...gmail, payload: { since: "yesterday" } };
  const today = assembleToday(parts({ snapshots: [broken], activeSprint: null, dailyMessage: null }));
  assert.equal(today.banner.gmail, null);
  assert.equal(today.banner.orphans, null);
  assert.equal(today.banner.dailyMessage, null);
  assert.equal(today.workingOn.activeSprint, null);
  assert.equal(today.warnings.waiting.gmailNeedsReply, 0);
  assert.deepEqual([today.warnings.waiting.orphans.sonarr, today.warnings.waiting.orphans.radarr], [0, 0]);
});

test("today: an unavailable Seerr shows as null plus its reason, not an error", () => {
  const seerr = { count: null, source: { ok: false, lastSyncAt: null, error: "SEERR_URL is not configured" } };
  const today = assembleToday(parts({ seerr }));
  assert.equal(today.warnings.waiting.seerrPending, null);
  assert.deepEqual(today.sources.seerr, seerr.source);
});

test("calendar source: sync error, never synced, overdue, healthy", () => {
  const lastSyncAt = new Date(NOW.getTime() - 5 * 60_000).toISOString();
  assert.deepEqual(calendarSource(timeline({ lastSyncAt, syncError: "invalid_grant" }), NOW), { ok: false, lastSyncAt, error: "invalid_grant" });
  assert.deepEqual(calendarSource(timeline({ lastSyncAt: null }), NOW), { ok: false, lastSyncAt: null, error: "Calendar has not synced yet" });
  const old = new Date(NOW.getTime() - CALENDAR_STALE_MS - 1).toISOString();
  assert.deepEqual(calendarSource(timeline({ lastSyncAt: old }), NOW), { ok: false, lastSyncAt: old, error: "Calendar sync is overdue" });
  assert.deepEqual(calendarSource(timeline({ lastSyncAt }), NOW), { ok: true, lastSyncAt, error: null });
});

test("Seerr count: answer, upstream error, timeout, unexpected error", async () => {
  const lastOkAt = new Date(NOW.getTime() - 120_000);
  const options = { now: NOW, lastOkAt, timeoutMs: 50 };

  assert.deepEqual(await checkSeerrCount(async () => 3, options), { count: 3, source: { ok: true, lastSyncAt: NOW.toISOString(), error: null } });

  const refused = await checkSeerrCount(async () => {
    throw new HttpError("SEERR_UNAVAILABLE", "Seerr could not be reached");
  }, options);
  assert.deepEqual(refused, { count: null, source: { ok: false, lastSyncAt: lastOkAt.toISOString(), error: "Seerr could not be reached" } });

  const started = Date.now();
  const slow = await checkSeerrCount(() => new Promise<number>(() => {}), options);
  assert.ok(Date.now() - started < 1_000, "the deadline should cut the call short");
  assert.deepEqual(slow, { count: null, source: { ok: false, lastSyncAt: lastOkAt.toISOString(), error: "Seerr did not answer within 0.05 s" } });

  const odd = await checkSeerrCount(async () => {
    throw new Error("socket hang up with secret details");
  }, { ...options, lastOkAt: null });
  assert.deepEqual(odd, { count: null, source: { ok: false, lastSyncAt: null, error: "Seerr is unavailable" } });
});

test("Sonarr/Radarr/Seerr links: http(s) only, blank is null", () => {
  assert.equal(linkFromEnv(" https://sonarr.example.com "), "https://sonarr.example.com");
  assert.equal(linkFromEnv(""), null);
  assert.equal(linkFromEnv(undefined), null);
  assert.equal(linkFromEnv("javascript:alert(1)"), null);
  assert.equal(linkFromEnv("not a url"), null);
});
