import type { BannerKind, DailyMessage, Prisma, Sprint } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import { listRequests } from "@/lib/integrations/seerr/client";
import { loadSeerrConfig } from "@/lib/integrations/seerr/config";
import { dashboardTimeZone, localDateString } from "@/lib/time/zone";
import { getTimeline } from "@/lib/timeline/query";
import type { BannerDto, BannerPayload, SourceStateDto, TimelineResponse, TodayResponse } from "@/types/dashboard-contracts";
import { parseSnapshotPayload } from "./banner-payload";
import { alertInclude, type AlertRow, cardInclude, type CardRow, dateOnly, toAlertDto, toDbDate, toSprintDto, toWorkCardDto } from "./dto";

// GET /api/today: everything the page needs in one call.
// Each integration degrades on its own: a failing Seerr or
// calendar sync shows up in `sources`, never as a 500.

/** The Waiting panel's Seerr count is read live; the page must not wait longer than this for it. */
export const SEERR_TODAY_TIMEOUT_MS = 3_000;
/** The worker syncs the calendar every 2 minutes; no successful sync for this long means it is down. */
export const CALENDAR_STALE_MS = 10 * 60_000;

export interface SnapshotRow {
  kind: BannerKind;
  payload: Prisma.JsonValue;
  capturedAt: Date;
}

export interface SeerrCheck {
  /** Pending requests in Seerr; null when Seerr could not be asked. */
  count: number | null;
  source: SourceStateDto;
}

/** Everything getToday reads, so the response can be assembled (and tested) without a database. */
export interface TodayParts {
  date: string;
  timeZone: string;
  now: Date;
  timeline: TimelineResponse;
  activeSprint: Sprint | null;
  cards: CardRow[];
  alerts: AlertRow[];
  /** The newest snapshot of each banner kind. */
  snapshots: SnapshotRow[];
  dailyMessage: DailyMessage | null;
  seerr: SeerrCheck;
  links: { sonarrUrl: string | null; radarrUrl: string | null; seerrUrl: string | null };
}

type SnapshotData<K extends BannerKind> = Extract<BannerPayload, { kind: K }>["payload"];

/** The stored snapshot of `kind`, re-validated so an old or malformed row hides its slide instead of breaking the page. */
function bannerSlide<K extends BannerKind>(snapshots: SnapshotRow[], kind: K): { capturedAt: string; data: SnapshotData<K> } | null {
  const row = snapshots.find((snapshot) => snapshot.kind === kind);
  if (!row) return null;
  try {
    return { capturedAt: row.capturedAt.toISOString(), data: parseSnapshotPayload(kind, row.payload) as SnapshotData<K> };
  } catch (error) {
    console.warn(`[today] ignoring the stored ${kind} snapshot: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Calendar health from the sync state getTimeline already read for GOOGLE_CALENDAR_ID. */
export function calendarSource(timeline: TimelineResponse, now: Date, staleMs = CALENDAR_STALE_MS): SourceStateDto {
  const { lastSyncAt, syncError } = timeline;
  if (syncError) return { ok: false, lastSyncAt, error: syncError };
  if (!lastSyncAt) return { ok: false, lastSyncAt: null, error: "Calendar has not synced yet" };
  if (now.getTime() - new Date(lastSyncAt).getTime() > staleMs) return { ok: false, lastSyncAt, error: "Calendar sync is overdue" };
  return { ok: true, lastSyncAt, error: null };
}

/** Asks `count` with a deadline. Never throws: a failure becomes `count: null` plus the reason. */
export async function checkSeerrCount(
  count: () => Promise<number>,
  options: { now: Date; lastOkAt: Date | null; timeoutMs: number },
): Promise<SeerrCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new HttpError("SEERR_UNAVAILABLE", `Seerr did not answer within ${options.timeoutMs / 1000} s`)),
      options.timeoutMs,
    );
  });
  try {
    const total = await Promise.race([count(), deadline]);
    return { count: total, source: { ok: true, lastSyncAt: options.now.toISOString(), error: null } };
  } catch (error) {
    if (!(error instanceof HttpError)) console.warn(`[today] Seerr count failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      count: null,
      source: {
        ok: false,
        lastSyncAt: options.lastOkAt?.toISOString() ?? null,
        // HttpError messages from the Seerr client are written for the page and never carry the API key.
        error: error instanceof HttpError ? error.message : "Seerr is unavailable",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// When this process last got a count from Seerr, for "Seerr unavailable — last checked 10:40".
const memory = globalThis as unknown as { todaySeerrLastOkAt?: Date };

async function liveSeerrPending(now: Date, env: NodeJS.ProcessEnv): Promise<SeerrCheck> {
  // Same filter as the Seerr bubble and the worker's poll, so the three always agree.
  const count = async () => (await listRequests(loadSeerrConfig(env), "pending", 1)).total;
  const result = await checkSeerrCount(count, { now, lastOkAt: memory.todaySeerrLastOkAt ?? null, timeoutMs: SEERR_TODAY_TIMEOUT_MS });
  if (result.source.ok) memory.todaySeerrLastOkAt = now;
  return result;
}

/**
 * SONARR_URL / RADARR_URL (D11) and SEERR_PUBLIC_URL are links only; anything that is not http(s) is
 * dropped so it can't become a script link.
 */
export function linkFromEnv(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

/** Builds the response from what was read. Pure. */
export function assembleToday(parts: TodayParts): TodayResponse {
  const banner: BannerDto = {
    dailyMessage: parts.dailyMessage
      ? { date: dateOnly(parts.dailyMessage.date), text: parts.dailyMessage.text, author: parts.dailyMessage.author }
      : null,
    gmail: bannerSlide(parts.snapshots, "gmail"),
    orphans: bannerSlide(parts.snapshots, "orphans"),
    scan: bannerSlide(parts.snapshots, "scan"),
    stocks: bannerSlide(parts.snapshots, "stocks"),
  };
  const localToday = localDateString(parts.now, parts.timeZone);

  return {
    date: parts.date,
    timeZone: parts.timeZone,
    generatedAt: parts.now.toISOString(),
    banner,
    timeline: parts.timeline,
    workingOn: {
      activeSprint: parts.activeSprint ? toSprintDto(parts.activeSprint, localToday) : null,
      cards: parts.cards.map(toWorkCardDto),
    },
    warnings: {
      alerts: parts.alerts.map(toAlertDto),
      waiting: {
        gmailNeedsReply: banner.gmail?.data.needsReply.length ?? 0,
        seerrPending: parts.seerr.count,
        orphans: {
          sonarr: banner.orphans?.data.counts.sonarr ?? 0,
          radarr: banner.orphans?.data.counts.radarr ?? 0,
          sonarrUrl: parts.links.sonarrUrl,
          radarrUrl: parts.links.radarrUrl,
        },
        seerrUrl: parts.links.seerrUrl,
      },
    },
    sources: {
      calendar: calendarSource(parts.timeline, parts.now),
      seerr: parts.seerr.source,
    },
  };
}

/** GET /api/today?date=YYYY-MM-DD. `date` is validated by the route. */
const BANNER_KINDS = ["gmail", "orphans", "scan", "stocks"] as const;

/** Newest snapshot per kind. One indexed findFirst per kind: Prisma's `distinct` filters in memory. */
async function latestSnapshots(): Promise<SnapshotRow[]> {
  const rows = await Promise.all(
    BANNER_KINDS.map((kind) =>
      prisma.bannerSnapshot.findFirst({
        where: { kind },
        orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
        select: { kind: true, payload: true, capturedAt: true },
      }),
    ),
  );
  return rows.filter((row): row is SnapshotRow => row !== null);
}

export async function getToday(date: string, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<TodayResponse> {
  const timeZone = dashboardTimeZone(env);
  const [timeline, activeSprint, cards, alerts, snapshots, dailyMessage, seerr] = await Promise.all([
    getTimeline(date, now, env),
    // D8 allows one active sprint; if a race ever leaves two, show the newest.
    prisma.sprint.findFirst({ where: { status: "active" }, orderBy: [{ startsOn: "desc" }, { updatedAt: "desc" }] }),
    prisma.workCard.findMany({
      where: { status: { not: "archived" } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: cardInclude(now),
    }),
    prisma.alert.findMany({ where: { resolvedAt: null }, orderBy: { openedAt: "asc" }, include: alertInclude(now) }),
    latestSnapshots(),
    prisma.dailyMessage.findUnique({ where: { date: toDbDate(date) } }),
    liveSeerrPending(now, env),
  ]);

  return assembleToday({
    date,
    timeZone,
    now,
    timeline,
    activeSprint,
    cards,
    alerts,
    snapshots,
    dailyMessage,
    seerr,
    links: {
      sonarrUrl: linkFromEnv(env.SONARR_URL),
      radarrUrl: linkFromEnv(env.RADARR_URL),
      seerrUrl: linkFromEnv(env.SEERR_PUBLIC_URL),
    },
  });
}
