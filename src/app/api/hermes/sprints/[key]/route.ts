import { readJsonBody } from "@/lib/api/http";
import { upsertSprint } from "@/lib/dashboard/sprints";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseKeyParam } from "@/lib/hermes/keys";
import { parseUpsertSprint } from "@/lib/hermes/parse";

export const PUT = withHermesAuth(async (request: Request, context: { params: Promise<{ key: string }> }) => {
  const key = parseKeyParam((await context.params).key, "sprint", "key");
  const input = parseUpsertSprint(await readJsonBody(request));
  const result = await upsertSprint(key, input);
  return Response.json(result, { status: result.created ? 201 : 200 });
});
