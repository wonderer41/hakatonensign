import { HttpError, readJsonBody, withErrorHandling } from "@/lib/api/http";
import { parseUuid } from "@/lib/api/validation";
import { aggregateProjectAiContext } from "@/lib/ai/context";
import { answerProjectQuestion, parseAiMode } from "@/lib/ai/service";

export const POST = withErrorHandling(async (request: Request) => {
  const body = await readJsonBody(request);
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError("VALIDATION_ERROR", "Request body must be a JSON object");
  const values = body as Record<string, unknown>;
  const projectId = parseUuid(values.projectId, "projectId");
  if (typeof values.question !== "string" || !values.question.trim()) throw new HttpError("VALIDATION_ERROR", "question is required");
  if (values.question.trim().length > 1_000) throw new HttpError("VALIDATION_ERROR", "question must be at most 1000 characters");
  const mode = parseAiMode(values.mode);
  const context = await aggregateProjectAiContext(projectId);
  const data = await answerProjectQuestion(values.question, context, mode);
  return Response.json({ data });
});
