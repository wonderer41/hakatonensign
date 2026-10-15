import type { ApiError, ApiErrorCode } from "@/types/contracts";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UPSTREAM_ERROR: 502,
  HERMES_UNAVAILABLE: 502,
  SEERR_UNAVAILABLE: 502,
};

// Throw from services or route handlers; withErrorHandling turns it into an
// ApiError response with the matching status.
export class HttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): Response {
  const body: ApiError = {
    error: details === undefined ? { code, message } : { code, message, details },
  };
  return Response.json(body, { status: STATUS_BY_CODE[code] });
}

export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.code, error.message, error.details);
      }
      // Log server-side only; never return stack traces or connection details.
      console.error(error);
      return errorResponse("INTERNAL_ERROR", "Unexpected server error");
    }
  };
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError("VALIDATION_ERROR", "Request body must be valid JSON");
  }
}
