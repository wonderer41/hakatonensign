import { createHash, timingSafeEqual } from "node:crypto";
import { errorResponse, HttpError, withErrorHandling } from "@/lib/api/http";

// /api/hermes/* is machine-to-machine (D3): Hermes sends
// `Authorization: Bearer ${HERMES_DASHBOARD_TOKEN}`. The app runs as one process, so the
// rate limit is a plain in-memory window.

export const HERMES_RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const;

export interface RateLimiter {
  /** Records one request; returns 0 when allowed, otherwise the seconds to wait. */
  take(now?: number): number;
}

/** Sliding window: at most `limit` requests in any `windowMs`. */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits: number[] = [];
  return {
    take(now = Date.now()) {
      while (hits.length > 0 && hits[0] <= now - windowMs) hits.shift();
      if (hits.length >= limit) return Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
      hits.push(now);
      return 0;
    },
  };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

let warnedMissingToken = false;

/** Throws the right HttpError unless the Authorization header carries the configured token. */
export function assertHermesToken(authorization: string | null, env: NodeJS.ProcessEnv = process.env): void {
  const expected = env.HERMES_DASHBOARD_TOKEN?.trim() ?? "";
  if (!expected) {
    if (!warnedMissingToken) {
      warnedMissingToken = true;
      console.error("[hermes] HERMES_DASHBOARD_TOKEN is not set; every /api/hermes/* request is refused");
    }
    throw new HttpError("INTERNAL_ERROR", "Hermes writes are disabled: HERMES_DASHBOARD_TOKEN is not configured on the dashboard");
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  // Hashing first gives equal-length buffers, so the comparison never leaks the token length.
  if (!match || !timingSafeEqual(digest(match[1]), digest(expected))) {
    throw new HttpError("UNAUTHORIZED", "Missing or invalid bearer token");
  }
}

// On globalThis so every route bundle (and dev hot reloads) share one window per process.
const globalForHermes = globalThis as unknown as { hermesRateLimiter?: RateLimiter };
const limiter = (globalForHermes.hermesRateLimiter ??= createRateLimiter(HERMES_RATE_LIMIT.limit, HERMES_RATE_LIMIT.windowMs));

/**
 * Wraps a /api/hermes/* route handler: bearer check, then the rate limit, then the handler, all
 * inside withErrorHandling so errors use the shared envelope. Only authenticated requests spend
 * the budget, so another client on the network cannot starve Hermes with tokenless calls.
 */
export function withHermesAuth<Args extends [Request, ...unknown[]]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return withErrorHandling(async (...args: Args) => {
    assertHermesToken(args[0].headers.get("authorization"));
    const retryAfter = limiter.take();
    if (retryAfter > 0) {
      const response = errorResponse("RATE_LIMITED", `Too many requests; limit is ${HERMES_RATE_LIMIT.limit} per minute`, {
        retryAfterSeconds: retryAfter,
      });
      response.headers.set("Retry-After", String(retryAfter));
      return response;
    }
    return handler(...args);
  });
}
