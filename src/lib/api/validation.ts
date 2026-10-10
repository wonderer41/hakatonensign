import {
  EVENT_ACTIONS,
  EVENT_SOURCES,
  type CreateEventRequest,
  type CreateProjectRequest,
  type EventAction,
  type EventSource,
  type UpdateProjectRequest,
} from "@/types/contracts";
import { HttpError } from "./http";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new HttpError("VALIDATION_ERROR", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail(`${field} must be a valid UUID`);
  }
  return value.toLowerCase();
}

function requiredString(body: Record<string, unknown>, field: string, max: number): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${field} must be at most ${max} characters`);
  return trimmed;
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
  max: number,
): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(`${field} must be a string or null`);
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${field} must be at most ${max} characters`);
  return trimmed.length === 0 ? null : trimmed;
}

export function parseCreateProject(body: unknown): Required<CreateProjectRequest> {
  if (!isPlainObject(body)) fail("Request body must be a JSON object");
  return {
    name: requiredString(body, "name", 120),
    description: optionalString(body, "description", 1000),
  };
}

export function parseUpdateProject(body: unknown): UpdateProjectRequest {
  if (!isPlainObject(body)) fail("Request body must be a JSON object");
  return { name: requiredString(body, "name", 120) };
}

export type ValidatedEventInput = Required<CreateEventRequest> & {
  metadata: Record<string, unknown>;
};

export function parseCreateEvent(body: unknown): ValidatedEventInput {
  if (!isPlainObject(body)) fail("Request body must be a JSON object");

  const source = body.source;
  if (!EVENT_SOURCES.includes(source as EventSource)) {
    fail(`source must be one of: ${EVENT_SOURCES.join(", ")}`);
  }
  const action = body.action;
  if (!EVENT_ACTIONS.includes(action as EventAction)) {
    fail(`action must be one of: ${EVENT_ACTIONS.join(", ")}`);
  }

  const timestampRaw = requiredString(body, "timestamp", 64);
  const timestamp = new Date(timestampRaw);
  if (Number.isNaN(timestamp.getTime())) {
    fail("timestamp must be an ISO 8601 date-time");
  }

  const sourceUrl = optionalString(body, "sourceUrl", 2048);
  if (sourceUrl !== null && !/^https?:\/\//i.test(sourceUrl)) {
    fail("sourceUrl must be an http(s) URL");
  }

  const metadata = body.metadata ?? {};
  if (!isPlainObject(metadata)) fail("metadata must be a JSON object");

  return {
    projectId: parseUuid(body.projectId, "projectId"),
    source: source as EventSource,
    externalId: optionalString(body, "externalId", 512),
    timestamp: timestamp.toISOString(),
    actor: requiredString(body, "actor", 200),
    action: action as EventAction,
    summary: requiredString(body, "summary", 1000),
    sourceUrl,
    metadata,
  };
}

export function parseLimit(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    fail(`limit must be an integer between 1 and ${max}`);
  }
  return limit;
}
