import type { Actor, Prisma, Sprint } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { HttpError } from "@/lib/api/http";
import { describeRef, refWhere, type RowRef } from "@/lib/hermes/keys";
import type { SprintInput } from "@/lib/hermes/parse";
import { publishLiveEvent } from "@/lib/live/publish";
import { dashboardTimeZone, localDateString } from "@/lib/time/zone";
import type { HermesWriteResult, SprintDto } from "@/types/dashboard-contracts";
import { assertWritable, conflictError, retryOnUniqueViolation, VersionConflict } from "./concurrency";
import { dateOnly, toDbDate, toSprintDto } from "./dto";

function today(now: Date): string {
  return localDateString(now, dashboardTimeZone());
}

/** Fields of `input` that differ from the stored sprint, as Prisma update data. */
function sprintChanges(row: Sprint, input: SprintInput): { fields: string[]; data: Prisma.SprintUpdateManyMutationInput } {
  const fields: string[] = [];
  const data: Prisma.SprintUpdateManyMutationInput = {};
  if (input.name !== row.name) {
    fields.push("name");
    data.name = input.name;
  }
  if (input.goal !== undefined && input.goal !== row.goal) {
    fields.push("goal");
    data.goal = input.goal;
  }
  if (input.startsOn !== dateOnly(row.startsOn)) {
    fields.push("startsOn");
    data.startsOn = toDbDate(input.startsOn);
  }
  if (input.endsOn !== dateOnly(row.endsOn)) {
    fields.push("endsOn");
    data.endsOn = toDbDate(input.endsOn);
  }
  if (input.status !== undefined && input.status !== row.status) {
    fields.push("status");
    data.status = input.status;
  }
  return { fields, data };
}

/** D8: one active sprint at a time. Activating one closes whichever other sprint was active. */
async function closeOtherActiveSprints(tx: Prisma.TransactionClient, keepId: string): Promise<string[]> {
  const others = await tx.sprint.findMany({ where: { status: "active", id: { not: keepId } }, select: { id: true } });
  if (others.length === 0) return [];
  const ids = others.map((row) => row.id);
  await tx.sprint.updateMany({ where: { id: { in: ids } }, data: { status: "closed", version: { increment: 1 } } });
  return ids;
}

interface Outcome {
  id: string;
  created: boolean;
  changed: boolean;
  closedIds: string[];
}

/**
 * Idempotent create/update of a sprint (PUT /api/hermes/sprints/:key). By key it creates the
 * sprint when missing; by id (page-created sprints) it only updates, and a missing id is 404.
 */
export async function upsertSprint(
  ref: RowRef,
  input: SprintInput,
  options: { actor?: Actor; now?: Date } = {},
): Promise<HermesWriteResult<SprintDto>> {
  const { actor = "hermes", now = new Date() } = options;
  const outcome = await retryOnUniqueViolation(async () => {
    try {
      return await prisma.$transaction(async (tx): Promise<Outcome> => {
        const existing = await tx.sprint.findUnique({ where: refWhere(ref) });
        if (!existing) {
          if (ref.kind === "id") throw new HttpError("NOT_FOUND", `No sprint has ${describeRef(ref)}`);
          const row = await tx.sprint.create({
            data: {
              externalKey: ref.key,
              name: input.name,
              goal: input.goal ?? null,
              startsOn: toDbDate(input.startsOn),
              endsOn: toDbDate(input.endsOn),
              status: input.status ?? "planned",
              createdBy: actor,
            },
          });
          const closedIds = row.status === "active" ? await closeOtherActiveSprints(tx, row.id) : [];
          return { id: row.id, created: true, changed: true, closedIds };
        }

        const changes = sprintChanges(existing, input);
        if (changes.fields.length === 0) return { id: existing.id, created: false, changed: false, closedIds: [] };
        assertWritable(input, existing.version, changes.fields);
        const updated = await tx.sprint.updateMany({
          where: { id: existing.id, version: existing.version },
          data: { ...changes.data, version: { increment: 1 } },
        });
        if (updated.count === 0) throw new VersionConflict("stale_version", changes.fields, existing.version + 1, input.version);
        const activated = input.status === "active" && existing.status !== "active";
        const closedIds = activated ? await closeOtherActiveSprints(tx, existing.id) : [];
        return { id: existing.id, created: false, changed: true, closedIds };
      });
    } catch (error) {
      if (!(error instanceof VersionConflict)) throw error;
      const current = await prisma.sprint.findUniqueOrThrow({ where: refWhere(ref) });
      throw conflictError("sprint", new VersionConflict(error.reason, error.fields, current.version, error.sentVersion), toSprintDto(current, today(now)));
    }
  });

  const row = await prisma.sprint.findUniqueOrThrow({ where: { id: outcome.id } });
  if (outcome.changed) {
    await publishLiveEvent({ type: "sprint.upserted", sprintId: outcome.id });
    for (const sprintId of outcome.closedIds) await publishLiveEvent({ type: "sprint.upserted", sprintId });
  }
  return { data: toSprintDto(row, today(now)), created: outcome.created };
}

/**
 * Resolves a card's sprintKey to the sprint id for linking cards; null when no such sprint.
 * Takes a parsed ref (key or id:<uuid>), or a plain key string.
 */
export async function findSprintIdByKey(tx: Prisma.TransactionClient, ref: RowRef | string): Promise<string | null> {
  const where = typeof ref === "string" ? { externalKey: ref } : refWhere(ref);
  const row = await tx.sprint.findUnique({ where, select: { id: true } });
  return row?.id ?? null;
}
