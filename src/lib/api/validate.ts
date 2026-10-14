import { isDateString } from "@/lib/time/zone";
import { HttpError } from "./http";

// Small strict validators for JSON bodies. Every failure is a 400 VALIDATION_ERROR whose
// details.field names the offending path, e.g. "rows[3].price" or "needsReply[0].amount".
// Field paths are built by the caller with `fieldPath`; the root object uses ROOT.

export const ROOT = "";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function fieldPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent === ROOT ? key : `${parent}.${key}`;
}

function label(field: string): string {
  return field === ROOT ? "body" : field;
}

export function invalid(field: string, message: string): never {
  const name = label(field);
  throw new HttpError("VALIDATION_ERROR", `${name} ${message}`, { field: name });
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A JSON object whose keys are all in `known`; any other key is rejected by name. */
export function strictObject(value: unknown, field: string, known: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) invalid(field, "must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) invalid(fieldPath(field, key), "is not an allowed field");
  }
  return value;
}

/** Trimmed, non-empty string of at most `max` characters. */
export function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(field, "must be a string");
  const trimmed = value.trim();
  if (trimmed.length === 0) invalid(field, "must not be empty");
  if (trimmed.length > max) invalid(field, `must be at most ${max} characters`);
  return trimmed;
}

/** undefined stays undefined (field absent), null or "" becomes null (clear it). */
export function optionalString(value: unknown, field: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") invalid(field, "must be a string or null");
  const trimmed = value.trim();
  if (trimmed.length > max) invalid(field, `must be at most ${max} characters`);
  return trimmed.length === 0 ? null : trimmed;
}

export function httpUrl(value: unknown, field: string, max = 2048): string {
  const url = requiredString(value, field, max);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    invalid(field, "must be an http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") invalid(field, "must be an http(s) URL");
  return url;
}

export function optionalHttpUrl(value: unknown, field: string, max = 2048): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return httpUrl(value, field, max);
}

/** ISO 8601 date-time with an explicit offset (Z or ±HH:MM); returned normalized to UTC. */
export function isoDateTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE_TIME.test(value)) {
    invalid(field, "must be an ISO 8601 date-time with a time zone, e.g. 2026-10-14T13:00:00Z");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(field, "must be a real date-time");
  return date.toISOString();
}

/** A real calendar date written as YYYY-MM-DD. */
export function localDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !isDateString(value)) invalid(field, "must be a YYYY-MM-DD calendar date");
  return value;
}

export function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    invalid(field, `must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function integer(value: unknown, field: string, bounds: { min?: number; max?: number } = {}): number {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = bounds;
  if (typeof value !== "number" || !Number.isInteger(value)) invalid(field, "must be an integer");
  if (value < min || value > max) invalid(field, `must be between ${min} and ${max}`);
  return value;
}

export function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field, "must be a finite number");
  return value;
}

export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field, "must be true or false");
  return value;
}

export function arrayOf<T>(
  value: unknown,
  field: string,
  max: number,
  parseItem: (item: unknown, itemField: string) => T,
): T[] {
  if (!Array.isArray(value)) invalid(field, "must be an array");
  if (value.length > max) invalid(field, `must have at most ${max} entries`);
  return value.map((item, index) => parseItem(item, fieldPath(field, index)));
}

/** A free-form JSON object (e.g. meta), capped by its serialized size. */
export function jsonObject(value: unknown, field: string, maxBytes: number): Record<string, unknown> {
  if (!isPlainObject(value)) invalid(field, "must be a JSON object");
  const size = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (size > maxBytes) invalid(field, `must be at most ${maxBytes} bytes as JSON`);
  return value;
}

/** Runs `parse` only when the field is present. */
export function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}
