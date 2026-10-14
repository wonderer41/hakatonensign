import type { ApiErrorCode } from "@/types/contracts";

// Typed fetch for the page's own /api/* routes. Non-2xx answers throw ApiRequestError carrying the
// server's error envelope ({ error: { code, message, details } }, src/lib/api/http.ts), so a section
// can show "409: someone changed this card" or a 400's details.field next to the right input.

/** Codes the client adds: the server was unreachable, answered without an envelope, or sent non-JSON. */
export type ClientErrorCode = "NETWORK_ERROR" | "HTTP_ERROR" | "INVALID_RESPONSE";

export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";

  constructor(
    /** HTTP status; 0 when the request never got an answer. */
    readonly status: number,
    readonly code: ApiErrorCode | ClientErrorCode | (string & Record<never, never>),
    message: string,
    /** The envelope's details, e.g. { field: "durationMin" } or HermesConflictDetails on a 409. */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function isApiRequestError(error: unknown, code?: ApiRequestError["code"]): error is ApiRequestError {
  return error instanceof ApiRequestError && (code === undefined || error.code === code);
}

/** True for the rejection of a request you (or the dashboard) aborted; ignore those. */
export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The error for a non-2xx response, from its parsed body (undefined when it was empty or not JSON). */
export function toApiRequestError(status: number, body: unknown): ApiRequestError {
  const envelope = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (envelope && typeof envelope.code === "string" && typeof envelope.message === "string") {
    return new ApiRequestError(status, envelope.code, envelope.message, envelope.details);
  }
  return new ApiRequestError(status, "HTTP_ERROR", `The server answered ${status}`);
}

export interface FetchJsonInit extends Omit<RequestInit, "body"> {
  /** Sent as JSON with Content-Type: application/json. */
  json?: unknown;
}

/**
 * fetch() + JSON for same-origin /api/* calls. Resolves with the parsed body (undefined for an empty
 * 2xx body); rejects with ApiRequestError, or with the AbortError when `signal` aborts.
 */
export async function fetchJson<T>(url: string, init: FetchJsonInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const sendHeaders = new Headers(headers);
  sendHeaders.set("Accept", "application/json");
  if (json !== undefined) sendHeaders.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...rest,
      headers: sendHeaders,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiRequestError(0, "NETWORK_ERROR", "Can't reach the dashboard server");
  }

  const text = await response.text();
  let body: unknown = undefined;
  let parsed = text.length === 0;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
      parsed = true;
    } catch {
      // handled below
    }
  }
  if (!response.ok) throw toApiRequestError(response.status, body);
  if (!parsed) throw new ApiRequestError(response.status, "INVALID_RESPONSE", "The server sent a response that isn't JSON");
  return body as T;
}
