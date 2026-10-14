import { HttpError } from "@/lib/api/http";
import type { SeerrDecisionRequest } from "@/types/dashboard-contracts";

const MAX_REQUEST_ID = 2_147_483_647;
const LIBRARIES: readonly SeerrDecisionRequest["library"][] = ["temp", "permanent"];

function invalid(message: string, field?: string): HttpError {
  return new HttpError("VALIDATION_ERROR", message, field === undefined ? undefined : { field });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The :id path segment: a positive integer Seerr request id. */
export function parseSeerrRequestId(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > MAX_REQUEST_ID) {
    throw invalid("id must be a positive integer", "id");
  }
  return Number(value);
}

/** POST /approve body: exactly { library: "temp" | "permanent" }. */
export function parseSeerrDecision(body: unknown): SeerrDecisionRequest {
  if (!isRecord(body)) throw invalid("Request body must be a JSON object");
  const unknown = Object.keys(body).find((key) => key !== "library");
  if (unknown !== undefined) throw invalid(`Unknown field: ${unknown}`, unknown);
  const library = body.library;
  if (!LIBRARIES.includes(library as SeerrDecisionRequest["library"])) {
    throw invalid(`library must be one of: ${LIBRARIES.join(", ")}`, "library");
  }
  return { library: library as SeerrDecisionRequest["library"] };
}

/** POST /decline takes no body; an empty body or {} is accepted, anything else is rejected. */
export function parseEmptyBody(raw: string): void {
  if (!raw.trim()) return;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw invalid("Request body must be valid JSON");
  }
  if (!isRecord(body)) throw invalid("Request body must be empty or {}");
  const unknown = Object.keys(body)[0];
  if (unknown !== undefined) throw invalid(`Unknown field: ${unknown}`, unknown);
}
