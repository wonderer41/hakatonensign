// Demo data for the page, taken from the approved design mockup.
// Usage: npm run db:seed            write or refresh the seed rows (dates are relative to today)
//        npm run db:seed -- --clean remove only the seed rows
//
// Idempotent: every row has a stable seed key, so running it again updates the same rows (and
// moves the timeline to today) instead of adding more. Keys: sprint/cards/items use externalKey
// "seed:…", the alert dedupeKey "seed:…", calendar events calendarId "seed" (the Google sync only
// touches its own calendarId, so it never cancels them), banner snapshots fixed ids 5eed0000-….
// The daily message is matched by its text. Real rows are never changed: the sprint is only made
// active when no other sprint is, and a daily message someone else wrote for today is kept.
import "dotenv/config";
import type { BannerKind, Prisma } from "@/generated/prisma/client";
import { parseSnapshotPayload } from "@/lib/dashboard/banner-payload";
import { toDbDate } from "@/lib/dashboard/dto";
import { sameJson } from "@/lib/dashboard/json";
import { prisma } from "@/lib/db/prisma";
import { publishLiveEvent } from "@/lib/live/publish";
import { addDays, dashboardTimeZone, datesSpanned, localDateString, zonedTimeToUtc } from "@/lib/time/zone";
import { SEED_CALENDAR_ID } from "@/lib/timeline/query";
import type { LiveEvent } from "@/types/dashboard-contracts";

const SEED_PREFIX = "seed:";
const SPRINT_KEY = "seed:sprint";
const ALERT_KEY = "seed:alert:vm100-backup";
const DAILY_MESSAGE = "[Your message for today]";
const SNAPSHOT_IDS: Record<BannerKind, string> = {
  gmail: "5eed0000-0000-4000-8000-000000000001",
  orphans: "5eed0000-0000-4000-8000-000000000002",
  scan: "5eed0000-0000-4000-8000-000000000003",
  stocks: "5eed0000-0000-4000-8000-000000000004",
};
const DAY_MS = 86_400_000;

interface SeedItem {
  slug: string;
  issueNumber: number;
  title: string;
  done: boolean;
  isCurrent?: boolean;
}

interface SeedCard {
  slug: string;
  title: string;
  milestoneTitle: string;
  hermesSuggestion: string | null;
  items: SeedItem[];
}

// "Working on" in the mockup. repoFullName stays null: the real repo names are Gerardo's to set (D7).
const CARDS: SeedCard[] = [
  {
    slug: "study-sessions",
    title: "study-sessions",
    milestoneTitle: "v0.2 review queue",
    hermesSuggestion: "Block 90 min tonight for #12?",
    items: [
      { slug: "4", issueNumber: 4, title: "Deck model and storage", done: true },
      { slug: "5", issueNumber: 5, title: "Card editor", done: true },
      { slug: "7", issueNumber: 7, title: "Import from CSV", done: true },
      { slug: "8", issueNumber: 8, title: "Review scheduling", done: true },
      { slug: "10", issueNumber: 10, title: "Session timer", done: true },
      { slug: "12", issueNumber: 12, title: "Spaced-repetition review flow", done: false, isCurrent: true },
      { slug: "13", issueNumber: 13, title: "Streak tracking", done: false },
      { slug: "14", issueNumber: 14, title: "Stats page", done: false },
    ],
  },
  {
    slug: "homelab-dashboard",
    title: "homelab-dashboard",
    milestoneTitle: "frontend v1",
    hermesSuggestion: null,
    items: [
      { slug: "1", issueNumber: 1, title: "Today column layout", done: false },
      { slug: "2", issueNumber: 2, title: "Style tiles", done: true },
      { slug: "3", issueNumber: 3, title: "Timeline component", done: false },
      { slug: "4", issueNumber: 4, title: "Working-on cards", done: false },
      { slug: "5", issueNumber: 5, title: "Banner slides", done: false },
      { slug: "6", issueNumber: 6, title: "Warnings rail", done: false },
    ],
  },
];

// The mockup's timeline, in local minutes after midnight. The work block is booked for study-sessions #12.
const EVENTS = [
  { slug: "class-morning", start: 480, end: 555, title: "[Class]" },
  { slug: "event-morning", start: 600, end: 660, title: "[Event]" },
  { slug: "class-afternoon", start: 780, end: 855, title: "[Class]" },
  { slug: "work-shift", start: 930, end: 1110, title: "[Work shift]" },
  { slug: "work-block-12", start: 1140, end: 1230, title: "Work block · #12 review flow", workBlockFor: "seed:item:study-sessions:12" },
  { slug: "event-evening", start: 1260, end: 1290, title: "[Event]" },
] as const;

// D9 starting watchlist; prices and changes are made up (signs follow the mockup's up/down pattern).
const STOCKS: [symbol: string, price: number, dayChangePct: number, sixMonthChangePct: number][] = [
  ["NVDA", 181.2, 1.4, 22.5],
  ["AMD", 164.35, -0.8, 14.2],
  ["MU", 128.9, 2.1, -6.8],
  ["TSLA", 248.1, -1.2, -11.4],
  ["AMZN", 219.45, 0.6, 9.3],
  ["XOM", 112.05, 0.9, -4.1],
  ["CVX", 151.3, -0.4, 3.6],
  ["COP", 98.7, -1.1, 12.0],
  ["CEG", 284.6, -2.3, -7.5],
  ["VST", 152.25, 0.7, 31.2],
  ["NEE", 74.8, -0.5, 5.4],
  ["TSM", 196.4, 1.8, -2.9],
];

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/** True when any field of `next` differs from the stored row. */
function differs(row: object, next: object): boolean {
  const stored = row as Record<string, unknown>;
  return Object.entries(next).some(([key, value]) => !same(stored[key], value));
}

interface Tally {
  created: number;
  updated: number;
  unchanged: number;
}

function tally(): Tally {
  return { created: 0, updated: 0, unchanged: 0 };
}

async function seed(): Promise<void> {
  const now = new Date();
  const timeZone = dashboardTimeZone();
  const today = localDateString(now, timeZone);
  // A local wall-clock time today, never later than now (so "since 08:00" is not in the future before 08:00).
  const at = (minutes: number) => new Date(Math.min(now.getTime(), zonedTimeToUtc(today, minutes, timeZone).getTime()));
  const events: LiveEvent[] = [];
  const counts = { sprint: tally(), cards: tally(), items: tally(), events: tally(), snapshots: tally(), alert: tally(), message: tally() };
  let sprintNote = "";
  let messageNote = "";

  await prisma.$transaction(
    async (tx) => {
      // ---------- Sprint (D8: only made active when no other sprint is) ----------
      const existingSprint = await tx.sprint.findUnique({ where: { externalKey: SPRINT_KEY } });
      const otherActive = await tx.sprint.findFirst({
        where: { status: "active", ...(existingSprint ? { id: { not: existingSprint.id } } : {}) },
        select: { name: true },
      });
      const sprintData = {
        name: "Seed sprint",
        goal: "Review queue for study-sessions and the dashboard frontend",
        startsOn: toDbDate(addDays(today, -2)),
        endsOn: toDbDate(addDays(today, 11)),
        status: otherActive ? ("planned" as const) : ("active" as const),
        createdBy: "user" as const,
      };
      if (otherActive) sprintNote = ` (left planned: "${otherActive.name}" is the active sprint)`;
      let sprintId: string;
      if (!existingSprint) {
        sprintId = (await tx.sprint.create({ data: { externalKey: SPRINT_KEY, ...sprintData } })).id;
        counts.sprint.created += 1;
        events.push({ type: "sprint.upserted", sprintId });
      } else {
        sprintId = existingSprint.id;
        if (differs(existingSprint, sprintData)) {
          await tx.sprint.update({ where: { id: sprintId }, data: { ...sprintData, version: { increment: 1 } } });
          counts.sprint.updated += 1;
          events.push({ type: "sprint.upserted", sprintId });
        } else counts.sprint.unchanged += 1;
      }

      // ---------- Cards and checklist items ----------
      const itemIds = new Map<string, string>();
      for (const [cardIndex, card] of CARDS.entries()) {
        const key = `${SEED_PREFIX}card:${card.slug}`;
        const cardData = {
          title: card.title,
          repoFullName: null,
          milestoneTitle: card.milestoneTitle,
          sprintId,
          status: "active" as const,
          position: (cardIndex + 1) * 1000,
          createdBy: "user" as const,
          hermesSuggestion: card.hermesSuggestion,
        };
        const existingCard = await tx.workCard.findUnique({ where: { externalKey: key } });
        let cardId: string;
        let cardChanged = false;
        if (!existingCard) {
          cardId = (await tx.workCard.create({ data: { externalKey: key, ...cardData } })).id;
          counts.cards.created += 1;
          cardChanged = true;
        } else {
          cardId = existingCard.id;
          if (differs(existingCard, cardData)) {
            await tx.workCard.update({ where: { id: cardId }, data: { ...cardData, version: { increment: 1 } } });
            counts.cards.updated += 1;
            cardChanged = true;
          } else counts.cards.unchanged += 1;
        }

        for (const [itemIndex, item] of card.items.entries()) {
          const itemKey = `${SEED_PREFIX}item:${card.slug}:${item.slug}`;
          const existingItem = await tx.checklistItem.findUnique({ where: { externalKey: itemKey } });
          // A done item keeps the doneAt it already has; a new one is spread over the last days.
          const doneAt = item.done ? (existingItem?.done && existingItem.doneAt ? existingItem.doneAt : new Date(now.getTime() - (card.items.length - itemIndex) * DAY_MS)) : null;
          const itemData = {
            cardId,
            title: item.title,
            issueNumber: item.issueNumber,
            sourceUrl: null,
            done: item.done,
            doneAt,
            isCurrent: item.isCurrent ?? false,
            position: (itemIndex + 1) * 1000,
            createdBy: "user" as const,
          };
          if (!existingItem) {
            itemIds.set(itemKey, (await tx.checklistItem.create({ data: { externalKey: itemKey, ...itemData } })).id);
            counts.items.created += 1;
            cardChanged = true;
          } else {
            itemIds.set(itemKey, existingItem.id);
            if (differs(existingItem, itemData)) {
              await tx.checklistItem.update({ where: { id: existingItem.id }, data: { ...itemData, version: { increment: 1 } } });
              counts.items.updated += 1;
              cardChanged = true;
            } else counts.items.unchanged += 1;
          }
        }
        if (cardChanged) events.push({ type: "card.upserted", cardId });
      }

      // ---------- Timeline: today's calendar, one Hermes work block ----------
      let timelineChanged = false;
      for (const event of EVENTS) {
        const externalId = `${SEED_PREFIX}event:${event.slug}`;
        const eventData = {
          title: event.title,
          startsAt: zonedTimeToUtc(today, event.start, timeZone),
          endsAt: zonedTimeToUtc(today, event.end, timeZone),
          allDay: false,
          kind: "workBlockFor" in event ? ("work_block" as const) : ("calendar" as const),
          status: "confirmed" as const,
          checklistItemId: "workBlockFor" in event ? (itemIds.get(event.workBlockFor) ?? null) : null,
          alertId: null,
          etag: null,
          htmlLink: null,
        };
        const where = { calendarId_externalId: { calendarId: SEED_CALENDAR_ID, externalId } };
        const existingEvent = await tx.calendarEvent.findUnique({ where });
        if (!existingEvent) {
          await tx.calendarEvent.create({ data: { calendarId: SEED_CALENDAR_ID, externalId, ...eventData, syncedAt: now } });
          counts.events.created += 1;
          timelineChanged = true;
        } else if (differs(existingEvent, eventData)) {
          await tx.calendarEvent.update({ where, data: { ...eventData, syncedAt: now } });
          counts.events.updated += 1;
          timelineChanged = true;
        } else counts.events.unchanged += 1;
      }
      if (timelineChanged) events.push({ type: "timeline.changed", date: today });

      // ---------- Banner snapshots (validated like PUT /api/hermes/banner/:kind) ----------
      const snapshots: { kind: BannerKind; capturedAt: Date; payload: unknown }[] = [
        {
          kind: "gmail",
          capturedAt: at(11 * 60 + 30),
          payload: {
            since: at(8 * 60).toISOString(),
            needsReply: [{ from: "[Sender]", subject: "[Subject line]" }],
            packages: [
              { label: "[Store / item]", status: "Out for delivery" },
              { label: "[Store / item]", status: "Shipped" },
            ],
            payments: [
              { merchant: "[Merchant]", at: at(9 * 60 + 12).toISOString() },
              { merchant: "[Merchant]", at: at(8 * 60 + 40).toISOString() },
              { merchant: "[Merchant]", at: at(8 * 60 + 5).toISOString() },
            ],
            deletedCount: 14,
          },
        },
        {
          kind: "orphans",
          capturedAt: at(6 * 60 + 15),
          payload: {
            items: [
              { name: "[Series] S01E04", kind: "episode", arr: "sonarr" },
              { name: "[Series] S01E05", kind: "episode", arr: "sonarr" },
              { name: "[Series] S02E11", kind: "episode", arr: "sonarr" },
              { name: "[Anime] E07", kind: "episode", arr: "sonarr" },
              { name: "[Movie] (year)", kind: "movie", arr: "radarr" },
              { name: "[Series] S03E01", kind: "episode", arr: "sonarr" },
            ],
            counts: { sonarr: 5, radarr: 1 },
          },
        },
        {
          kind: "scan",
          capturedAt: at(6 * 60),
          payload: { ranAt: at(6 * 60).toISOString(), up: 17, total: 18, issues: [{ container: "[container]", summary: "[one-line status]" }] },
        },
        {
          kind: "stocks",
          capturedAt: at(11 * 60 + 40),
          payload: {
            asOf: at(11 * 60 + 40).toISOString(),
            rows: STOCKS.map(([symbol, price, dayChangePct, sixMonthChangePct]) => ({ symbol, price, currency: "USD", dayChangePct, sixMonthChangePct })),
          },
        },
      ];
      for (const snapshot of snapshots) {
        const payload = parseSnapshotPayload(snapshot.kind, snapshot.payload) as unknown as Prisma.InputJsonObject;
        const id = SNAPSHOT_IDS[snapshot.kind];
        const existingSnapshot = await tx.bannerSnapshot.findUnique({ where: { id } });
        if (!existingSnapshot) {
          await tx.bannerSnapshot.create({ data: { id, kind: snapshot.kind, payload, capturedAt: snapshot.capturedAt, pushedBy: "system" } });
          counts.snapshots.created += 1;
        } else if (!sameJson(existingSnapshot.payload, payload) || !same(existingSnapshot.capturedAt, snapshot.capturedAt)) {
          await tx.bannerSnapshot.update({ where: { id }, data: { payload, capturedAt: snapshot.capturedAt } });
          counts.snapshots.updated += 1;
        } else {
          counts.snapshots.unchanged += 1;
          continue;
        }
        events.push({ type: "banner.updated", kind: snapshot.kind });
      }

      // ---------- One open alert for the Broken panel ----------
      const alertData = { source: "proxmox", title: "VM 100 backup missed", detail: "vzdump · Sun 01:00", severity: "warning" as const, resolvedAt: null };
      const existingAlert = await tx.alert.findUnique({ where: { dedupeKey: ALERT_KEY } });
      if (!existingAlert) {
        const created = await tx.alert.create({ data: { dedupeKey: ALERT_KEY, ...alertData, openedAt: now } });
        counts.alert.created += 1;
        events.push({ type: "alert.changed", alertId: created.id });
      } else if (differs(existingAlert, alertData)) {
        // Reopened alerts start counting again, like a Hermes push for a resolved alert.
        await tx.alert.update({ where: { id: existingAlert.id }, data: { ...alertData, ...(existingAlert.resolvedAt ? { openedAt: now } : {}) } });
        counts.alert.updated += 1;
        events.push({ type: "alert.changed", alertId: existingAlert.id });
      } else counts.alert.unchanged += 1;

      // ---------- Daily message (kept if someone else already wrote today's) ----------
      const date = toDbDate(today);
      const existingMessage = await tx.dailyMessage.findUnique({ where: { date } });
      if (!existingMessage) {
        await tx.dailyMessage.create({ data: { date, text: DAILY_MESSAGE, author: "system" } });
        counts.message.created += 1;
        events.push({ type: "banner.updated", kind: "dailyMessage" });
      } else if (existingMessage.text === DAILY_MESSAGE) {
        counts.message.unchanged += 1;
      } else {
        counts.message.unchanged += 1;
        messageNote = ` (kept today's message by ${existingMessage.author})`;
      }
    },
    { timeout: 30_000 },
  );

  for (const event of events) await publishLiveEvent(event);

  const line = (label: string, t: Tally, note = "") => console.log(`  ${label.padEnd(18)} ${t.created} created · ${t.updated} updated · ${t.unchanged} unchanged${note}`);
  console.log(`Seeded ${today} (${timeZone})`);
  line("sprint", counts.sprint, sprintNote);
  line("cards", counts.cards);
  line("checklist items", counts.items);
  line("calendar events", counts.events);
  line("banner snapshots", counts.snapshots);
  line("alert", counts.alert);
  line("daily message", counts.message, messageNote);
  console.log(`  live events        ${events.length} published`);
  console.log("Remove with: npm run db:seed -- --clean");
}

async function clean(): Promise<void> {
  const timeZone = dashboardTimeZone();
  const seedEvents = await prisma.calendarEvent.findMany({ where: { calendarId: SEED_CALENDAR_ID }, select: { startsAt: true, endsAt: true } });
  const dates = new Set(seedEvents.flatMap((event) => datesSpanned(event.startsAt, event.endsAt, timeZone)));
  const [cards, sprints, alerts] = await Promise.all([
    prisma.workCard.findMany({ where: { externalKey: { startsWith: SEED_PREFIX } }, select: { id: true } }),
    prisma.sprint.findMany({ where: { externalKey: { startsWith: SEED_PREFIX } }, select: { id: true } }),
    prisma.alert.findMany({ where: { dedupeKey: { startsWith: SEED_PREFIX } }, select: { id: true } }),
  ]);

  // Items, their progress notes and schedule requests go with their card (onDelete: Cascade).
  const [calendarEvents, cardRows, sprintRows, alertRows, snapshots, messages] = await prisma.$transaction([
    prisma.calendarEvent.deleteMany({ where: { calendarId: SEED_CALENDAR_ID } }),
    prisma.workCard.deleteMany({ where: { externalKey: { startsWith: SEED_PREFIX } } }),
    prisma.sprint.deleteMany({ where: { externalKey: { startsWith: SEED_PREFIX } } }),
    prisma.alert.deleteMany({ where: { dedupeKey: { startsWith: SEED_PREFIX } } }),
    prisma.bannerSnapshot.deleteMany({ where: { id: { in: Object.values(SNAPSHOT_IDS) } } }),
    prisma.dailyMessage.deleteMany({ where: { text: DAILY_MESSAGE } }),
  ]);

  const events: LiveEvent[] = [
    ...cards.map((card) => ({ type: "card.removed" as const, cardId: card.id })),
    ...sprints.map((sprint) => ({ type: "sprint.upserted" as const, sprintId: sprint.id })),
    ...alerts.map((alert) => ({ type: "alert.changed" as const, alertId: alert.id })),
    ...[...dates].map((date) => ({ type: "timeline.changed" as const, date })),
  ];
  if (snapshots.count > 0) events.push(...(["gmail", "orphans", "scan", "stocks"] as const).map((kind) => ({ type: "banner.updated" as const, kind })));
  if (messages.count > 0) events.push({ type: "banner.updated", kind: "dailyMessage" });
  for (const event of events) await publishLiveEvent(event);

  console.log("Removed seed rows:");
  console.log(`  sprints ${sprintRows.count} · cards ${cardRows.count} (with their items) · calendar events ${calendarEvents.count}`);
  console.log(`  banner snapshots ${snapshots.count} · alerts ${alertRows.count} · daily messages ${messages.count}`);
}

const run = process.argv.slice(2).includes("--clean") ? clean : seed;
run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
