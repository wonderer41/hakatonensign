import type { Prisma, SprintStatus } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { invalid } from "@/lib/api/validate";
import { prisma } from "@/lib/db/prisma";
import { publishLiveEvent } from "@/lib/live/publish";
import { dashboardTimeZone, localDateString } from "@/lib/time/zone";
import type { SprintDto } from "@/types/dashboard-contracts";
import { VersionConflict } from "./concurrency";
import { dateOnly, toDbDate, toSprintDto } from "./dto";
import { staleEditError } from "./user-conflict";
import type { CreateSprintInput, UpdateSprintInput } from "./user-parse";

// Browser routes for sprints (/api/sprints). D8: one active sprint at a time; activating one
// closes whichever other sprint was active, in the same transaction.

function today(now: Date): string {
  return localDateString(now, dashboardTimeZone());
}

async function closeOtherActiveSprints(tx: Prisma.TransactionClient, keepId: string): Promise<string[]> {
  const others = await tx.sprint.findMany({ where: { status: "active", id: { not: keepId } }, select: { id: true } });
  if (others.length === 0) return [];
  const ids = others.map((row) => row.id);
  await tx.sprint.updateMany({ where: { id: { in: ids } }, data: { status: "closed", version: { increment: 1 } } });
  return ids;
}

async function publishSprints(ids: string[]): Promise<void> {
  for (const sprintId of ids) await publishLiveEvent({ type: "sprint.upserted", sprintId });
}

/** GET /api/sprints?status=: newest first. */
export async function listSprints(status: SprintStatus | undefined, now = new Date()): Promise<SprintDto[]> {
  const rows = await prisma.sprint.findMany({
    where: status ? { status } : {},
    orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
  });
  const date = today(now);
  return rows.map((row) => toSprintDto(row, date));
}

/** POST /api/sprints. */
export async function createSprint(input: CreateSprintInput, now = new Date()): Promise<SprintDto> {
  const { row, closedIds } = await prisma.$transaction(async (tx) => {
    const created = await tx.sprint.create({
      data: {
        name: input.name,
        goal: input.goal,
        startsOn: toDbDate(input.startsOn),
        endsOn: toDbDate(input.endsOn),
        status: input.status,
        createdBy: "user",
      },
    });
    return { row: created, closedIds: created.status === "active" ? await closeOtherActiveSprints(tx, created.id) : [] };
  });
  await publishSprints([row.id, ...closedIds]);
  return toSprintDto(row, today(now));
}

/** PATCH /api/sprints/:id. Needs the version the page last read (D15). */
export async function updateSprint(id: string, input: UpdateSprintInput, now = new Date()): Promise<SprintDto> {
  let outcome: { changed: boolean; closedIds: string[] };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const row = await tx.sprint.findUnique({ where: { id } });
      if (!row) throw new HttpError("NOT_FOUND", `No sprint has id ${id}`);

      const startsOn = input.startsOn ?? dateOnly(row.startsOn);
      const endsOn = input.endsOn ?? dateOnly(row.endsOn);
      if (endsOn < startsOn) invalid("endsOn", "must be on or after startsOn");

      const fields: string[] = [];
      const data: Prisma.SprintUpdateManyMutationInput = {};
      if (input.name !== undefined && input.name !== row.name) {
        fields.push("name");
        data.name = input.name;
      }
      if (input.goal !== undefined && input.goal !== row.goal) {
        fields.push("goal");
        data.goal = input.goal;
      }
      if (startsOn !== dateOnly(row.startsOn)) {
        fields.push("startsOn");
        data.startsOn = toDbDate(startsOn);
      }
      if (endsOn !== dateOnly(row.endsOn)) {
        fields.push("endsOn");
        data.endsOn = toDbDate(endsOn);
      }
      if (input.status !== undefined && input.status !== row.status) {
        fields.push("status");
        data.status = input.status;
      }

      // Nothing to change: answer with the current sprint, whatever version was sent.
      if (fields.length === 0) return { changed: false, closedIds: [] };
      if (input.version !== row.version) throw new VersionConflict("stale_version", fields, row.version, input.version);
      const updated = await tx.sprint.updateMany({ where: { id, version: row.version }, data: { ...data, version: { increment: 1 } } });
      if (updated.count === 0) throw new VersionConflict("stale_version", fields, row.version + 1, input.version);
      const activated = data.status === "active";
      return { changed: true, closedIds: activated ? await closeOtherActiveSprints(tx, id) : [] };
    });
  } catch (error) {
    if (!(error instanceof VersionConflict)) throw error;
    const current = await prisma.sprint.findUniqueOrThrow({ where: { id } });
    throw staleEditError("sprint", error, toSprintDto(current, today(now)));
  }

  const row = await prisma.sprint.findUniqueOrThrow({ where: { id } });
  if (outcome.changed) await publishSprints([id, ...outcome.closedIds]);
  return toSprintDto(row, today(now));
}

/** Throws 404 (details.field = `field`) unless the sprint exists. */
export async function assertSprintExists(tx: Prisma.TransactionClient, sprintId: string, field = "sprintId"): Promise<void> {
  const row = await tx.sprint.findUnique({ where: { id: sprintId }, select: { id: true } });
  if (!row) throw new HttpError("NOT_FOUND", `No sprint has id ${sprintId}`, { field });
}
