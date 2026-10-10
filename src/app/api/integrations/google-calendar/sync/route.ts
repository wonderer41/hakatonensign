import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { parseUuid } from "@/lib/api/validation";
import { syncGoogleCalendar } from "@/lib/integrations/google-calendar/sync";

export const POST = withErrorHandling(async (request: Request) => {
  const body = await readJsonBody(request);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Request body must be a JSON object" } }, { status: 400 });
  }
  const projectId = parseUuid((body as Record<string, unknown>).projectId, "projectId");
  const result = await syncGoogleCalendar(projectId);
  return Response.json({
    data: {
      projectId: result.projectId,
      calendarId: result.calendarId,
      fetched: result.fetched,
      created: result.created,
      duplicates: result.duplicates,
      syncedAt: result.syncedAt,
    },
  });
});
