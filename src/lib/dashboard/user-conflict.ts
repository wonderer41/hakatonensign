import { HttpError } from "@/lib/api/http";
import type { HermesConflictDetails } from "@/types/dashboard-contracts";
import type { VersionConflict } from "./concurrency";

/**
 * 409 CONFLICT for a page edit sent with a stale version (D15). `details` has the same shape as
 * the Hermes routes' conflicts — { reason, fields, currentVersion, data } — so the page can
 * replace its copy with `data` and let Gerardo retry.
 */
export function staleEditError<T extends { version: number }>(entity: string, conflict: VersionConflict, current: T): HttpError {
  const details: HermesConflictDetails<T> = {
    reason: "stale_version",
    fields: conflict.fields,
    currentVersion: current.version,
    data: current,
  };
  return new HttpError(
    "CONFLICT",
    `This ${entity} changed since you loaded it (you sent version ${conflict.sentVersion}, current version is ${current.version}); reload it and try again`,
    details,
  );
}
