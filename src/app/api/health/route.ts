import { prisma } from "@/lib/db/prisma";
import { safeErrorMessage } from "@/lib/live/redact";
import type { ApiError } from "@/types/contracts";

// Never prerender: the answer depends on the database being reachable right now.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Liveness + readiness for the container healthcheck and uptime monitors.
// `status` and `service` are kept from the original hackathon response.
export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    // Log server-side only (redacted); the client never sees connection details.
    console.error(`[health] database check failed: ${safeErrorMessage(error)}`);
    // Same envelope as src/lib/api/http.ts, but 503: errorResponse() maps INTERNAL_ERROR to 500,
    // and a "database is down" probe should read as "temporarily unavailable".
    const body: ApiError = {
      error: { code: "INTERNAL_ERROR", message: "Database is not reachable", details: { db: false } },
    };
    return Response.json(body, { status: 503, headers: NO_STORE });
  }
  return Response.json(
    { ok: true, db: true, status: "ok", service: "homelab-daily", time: new Date().toISOString() },
    { headers: NO_STORE },
  );
}
