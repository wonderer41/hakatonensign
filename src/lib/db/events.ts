import { Prisma } from "@/generated/prisma/client";
import type { PaginatedEvents, WorkEvent } from "@/types/contracts";
import { HttpError } from "@/lib/api/http";
import type { ValidatedEventInput } from "@/lib/api/validation";
import { toWorkEvent } from "./mappers";
import { assertProjectExists } from "./projects";
import { prisma } from "./prisma";

export interface IngestResult {
  event: WorkEvent;
  created: boolean;
}

async function findDuplicate(input: ValidatedEventInput) {
  if (input.externalId === null) return null;
  return prisma.workEvent.findUnique({
    where: {
      projectId_source_externalId: {
        projectId: input.projectId,
        source: input.source,
        externalId: input.externalId,
      },
    },
  });
}

// Shared ingestion path for POST /api/events and integrations (GitHub sync,
// etc.). Call this directly instead of making an internal HTTP request.
// Idempotent on (projectId, source, externalId) when externalId is set.
export async function ingestEvent(input: ValidatedEventInput): Promise<IngestResult> {
  await assertProjectExists(input.projectId);

  const existing = await findDuplicate(input);
  if (existing) return { event: toWorkEvent(existing), created: false };

  try {
    const [row] = await prisma.$transaction([
      prisma.workEvent.create({
        data: {
          projectId: input.projectId,
          source: input.source,
          externalId: input.externalId,
          timestamp: new Date(input.timestamp),
          actor: input.actor,
          action: input.action,
          summary: input.summary,
          sourceUrl: input.sourceUrl,
          metadata: input.metadata as Prisma.InputJsonObject,
        },
      }),
      // Keeps GET /api/projects ordered by most recent activity.
      prisma.project.update({
        where: { id: input.projectId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return { event: toWorkEvent(row), created: true };
  } catch (error) {
    // A concurrent ingest of the same event won the race; return its row.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const winner = await findDuplicate(input);
      if (winner) return { event: toWorkEvent(winner), created: false };
    }
    throw error;
  }
}

// Updates a source-owned snapshot in place when its stable external ID already
// exists. Integrations that model the current state of an external item can use
// this without changing the append-only behavior of ingestEvent().
export async function upsertEvent(input: ValidatedEventInput): Promise<IngestResult> {
  if (input.externalId === null) return ingestEvent(input);
  const externalId = input.externalId;
  await assertProjectExists(input.projectId);
  const existing = await findDuplicate(input);
  const row = await prisma.$transaction(async (transaction) => {
    const event = await transaction.workEvent.upsert({
      where: {
        projectId_source_externalId: {
          projectId: input.projectId,
          source: input.source,
          externalId,
        },
      },
      create: {
        projectId: input.projectId,
        source: input.source,
        externalId,
        timestamp: new Date(input.timestamp),
        actor: input.actor,
        action: input.action,
        summary: input.summary,
        sourceUrl: input.sourceUrl,
        metadata: input.metadata as Prisma.InputJsonObject,
      },
      update: {
        timestamp: new Date(input.timestamp),
        actor: input.actor,
        action: input.action,
        summary: input.summary,
        sourceUrl: input.sourceUrl,
        metadata: input.metadata as Prisma.InputJsonObject,
      },
    });
    await transaction.project.update({
      where: { id: input.projectId },
      data: { updatedAt: new Date() },
    });
    return event;
  });
  return { event: toWorkEvent(row), created: existing === null };
}

interface Cursor {
  t: string;
  id: string;
}

function encodeCursor(row: { timestamp: Date; id: string }): string {
  const cursor: Cursor = { t: row.timestamp.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof cursor?.t === "string" &&
      typeof cursor?.id === "string" &&
      !Number.isNaN(new Date(cursor.t).getTime())
    ) {
      return cursor;
    }
  } catch {
    // Fall through to the validation error below.
  }
  throw new HttpError("VALIDATION_ERROR", "cursor is invalid");
}

// Newest first, ordered by (timestamp, id) so pages are stable when several
// events share a timestamp.
export async function listEvents(
  projectId: string,
  limit: number,
  cursor: string | null,
): Promise<PaginatedEvents> {
  await assertProjectExists(projectId);

  const after = cursor === null ? null : decodeCursor(cursor);
  const rows = await prisma.workEvent.findMany({
    where: {
      projectId,
      ...(after && {
        OR: [
          { timestamp: { lt: new Date(after.t) } },
          { timestamp: new Date(after.t), id: { lt: after.id } },
        ],
      }),
    },
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  return {
    data: page.map(toWorkEvent),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

export async function listRecentEvents(projectId: string, take: number): Promise<WorkEvent[]> {
  const rows = await prisma.workEvent.findMany({
    where: { projectId },
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map(toWorkEvent);
}
