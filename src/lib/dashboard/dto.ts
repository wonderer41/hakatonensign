import type { Alert, ItemProgress, Prisma, Sprint } from "@/generated/prisma/client";
import { dashboardTimeZone } from "@/lib/time/zone";
import type { AlertDto, ChecklistItemDto, ItemProgressDto, SprintDto, WorkCardDto } from "@/types/dashboard-contracts";
import { formatMetaLine } from "./meta-line";

// Prisma row → DTO mappers shared by /api/hermes/* and, later, /api/today and the browser routes.

const DAY_MS = 86_400_000;

/** A @db.Date column comes back as UTC midnight; this returns its YYYY-MM-DD. */
export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A YYYY-MM-DD string as the Date Prisma expects for a @db.Date column. */
export function toDbDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Calendar days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / DAY_MS);
}

/** `today` is the local date in DASHBOARD_TIME_ZONE. daysLeft is 0 on the sprint's last day. */
export function toSprintDto(row: Sprint, today: string): SprintDto {
  const endsOn = dateOnly(row.endsOn);
  return {
    id: row.id,
    externalKey: row.externalKey,
    name: row.name,
    goal: row.goal,
    startsOn: dateOnly(row.startsOn),
    endsOn,
    status: row.status,
    daysLeft: row.status === "active" ? Math.max(0, daysBetween(today, endsOn)) : null,
    version: row.version,
  };
}

/** Next upcoming, not cancelled work block linked to an item or alert. */
function upcomingBlocks(now: Date) {
  return {
    where: { status: { not: "cancelled" }, endsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    take: 1,
    select: { id: true, startsAt: true, endsAt: true },
  } satisfies Prisma.ChecklistItem$calendarEventsArgs;
}

/** Push notes still waiting for Gerardo (D7), newest push first. */
const pendingProgress = {
  where: { status: "pending" },
  orderBy: [{ pushedAt: "desc" }, { createdAt: "desc" }],
} satisfies Prisma.ChecklistItem$progressArgs;

export function itemInclude(now: Date) {
  return { calendarEvents: upcomingBlocks(now), progress: pendingProgress } satisfies Prisma.ChecklistItemInclude;
}

export function cardInclude(now: Date) {
  return {
    items: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: itemInclude(now) },
  } satisfies Prisma.WorkCardInclude;
}

export function alertInclude(now: Date) {
  return { calendarEvents: upcomingBlocks(now) } satisfies Prisma.AlertInclude;
}

export type ItemRow = Prisma.ChecklistItemGetPayload<{ include: ReturnType<typeof itemInclude> }>;
export type CardRow = Prisma.WorkCardGetPayload<{ include: ReturnType<typeof cardInclude> }>;
export type AlertRow = Prisma.AlertGetPayload<{ include: ReturnType<typeof alertInclude> }>;

function scheduled(events: { id: string; startsAt: Date; endsAt: Date }[]): ChecklistItemDto["scheduled"] {
  const next = events[0];
  return next ? { calendarEventId: next.id, startsAt: next.startsAt.toISOString(), endsAt: next.endsAt.toISOString() } : null;
}

export function commitUrl(repoFullName: string, sha: string): string {
  return `https://github.com/${repoFullName}/commit/${sha}`;
}

export function toItemProgressDto(row: ItemProgress): ItemProgressDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    note: row.note,
    repoFullName: row.repoFullName,
    commitSha: row.commitSha,
    commitUrl: commitUrl(row.repoFullName, row.commitSha),
    pushedAt: row.pushedAt.toISOString(),
  };
}

export function toChecklistItemDto(row: ItemRow): ChecklistItemDto {
  return {
    id: row.id,
    cardId: row.cardId,
    externalKey: row.externalKey,
    title: row.title,
    issueNumber: row.issueNumber,
    sourceUrl: row.sourceUrl,
    done: row.done,
    doneAt: row.doneAt?.toISOString() ?? null,
    isCurrent: row.isCurrent,
    position: row.position,
    createdBy: row.createdBy,
    version: row.version,
    scheduled: scheduled(row.calendarEvents),
    // A checked item has nothing left to suggest; its notes stay stored but are not shown.
    progress: row.done ? [] : row.progress.map(toItemProgressDto),
  };
}

function byPosition<T extends { position: number; createdAt: Date }>(a: T, b: T): number {
  return a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime();
}

/** The isCurrent item ("now") if it is still open, else the first unchecked one ("next"); null when all are done. */
export function currentItem<T extends { id: string; done: boolean; isCurrent: boolean; position: number; createdAt: Date }>(
  items: T[],
): { item: T; label: "now" | "next" } | null {
  const ordered = [...items].sort(byPosition);
  const now = ordered.find((item) => item.isCurrent && !item.done);
  if (now) return { item: now, label: "now" };
  const next = ordered.find((item) => !item.done);
  return next ? { item: next, label: "next" } : null;
}

export function toWorkCardDto(row: CardRow): WorkCardDto {
  const items = [...row.items].sort(byPosition);
  const current = currentItem(items);
  return {
    id: row.id,
    externalKey: row.externalKey,
    title: row.title,
    repoFullName: row.repoFullName,
    milestoneTitle: row.milestoneTitle,
    sprintId: row.sprintId,
    status: row.status,
    position: row.position,
    createdBy: row.createdBy,
    metaLine: formatMetaLine(row, new Date(), dashboardTimeZone()),
    progress: { done: items.filter((item) => item.done).length, total: items.length },
    current: current ? { itemId: current.item.id, label: current.label } : null,
    hermesSuggestion: row.hermesSuggestion,
    items: items.map(toChecklistItemDto),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAlertDto(row: Alert & { calendarEvents: AlertRow["calendarEvents"] }): AlertDto {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    source: row.source,
    title: row.title,
    detail: row.detail,
    severity: row.severity,
    openedAt: row.openedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    scheduled: scheduled(row.calendarEvents),
  };
}
