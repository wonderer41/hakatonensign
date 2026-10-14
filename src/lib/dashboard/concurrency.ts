import { Prisma } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import type { HermesConflictDetails } from "@/types/dashboard-contracts";

// D15 — user edits win. A machine upsert that would change an existing row must either carry
// the version it last read or set force; otherwise 409 CONFLICT with the current row so Hermes
// can re-read. An upsert that changes nothing always succeeds without a version bump.

export type ConflictReason = HermesConflictDetails<unknown>["reason"];

export interface WriteGuard {
  version?: number;
  force: boolean;
}

/** Thrown inside a transaction; the service turns it into a 409 with the current DTO attached. */
export class VersionConflict extends Error {
  constructor(
    readonly reason: ConflictReason,
    readonly fields: string[],
    readonly currentVersion: number,
    readonly sentVersion: number | undefined,
  ) {
    super(reason);
  }
}

/**
 * Throws VersionConflict unless this change may be applied.
 * `userOwned` lists changed fields that need force regardless of version (e.g. an item's done).
 */
export function assertWritable(guard: WriteGuard, currentVersion: number, fields: string[], userOwned: string[] = []): void {
  if (guard.force) return;
  if (userOwned.length > 0) throw new VersionConflict("done_is_user_owned", userOwned, currentVersion, guard.version);
  if (guard.version === undefined) throw new VersionConflict("version_required", fields, currentVersion, undefined);
  if (guard.version !== currentVersion) throw new VersionConflict("stale_version", fields, currentVersion, guard.version);
}

export function conflictMessage(entity: string, conflict: VersionConflict): string {
  switch (conflict.reason) {
    case "done_is_user_owned":
      return `done on this ${entity} belongs to Gerardo; send "force": true only if he asked you to change it`;
    case "version_required":
      return `Changing this ${entity} (${conflict.fields.join(", ")}) needs the version you last read (current version ${conflict.currentVersion}); re-read GET /api/hermes/state, or send "force": true`;
    case "stale_version":
      return `This ${entity} changed after version ${conflict.sentVersion} (current version ${conflict.currentVersion}); re-read it before writing, or send "force": true`;
  }
}

export function conflictError<T>(entity: string, conflict: VersionConflict, data: T): HttpError {
  const details: HermesConflictDetails<T> = {
    reason: conflict.reason,
    fields: conflict.fields,
    currentVersion: conflict.currentVersion,
    data,
  };
  return new HttpError("CONFLICT", conflictMessage(entity, conflict), details);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Two first-time upserts of the same key can race; the loser retries once and takes the update path. */
export async function retryOnUniqueViolation<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return run();
  }
}
