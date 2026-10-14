import { readJsonBody } from "@/lib/api/http";
import { upsertSprint } from "@/lib/dashboard/sprints";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseKeyParam } from "@/lib/hermes/keys";
import { parseUpsertSprint } from "@/lib/hermes/parse";

// :key is the sprint's key or id:<uuid>.
export const PUT = withHermesAuth(async (request: Request, context: { params: Promise<{ key: string }> }) => {
  const sprint = parseKeyParam((await context.params).key, "sprint", "key");
  const input = parseUpsertSprint(await readJsonBody(request));
  const result = await upsertSprint(sprint, input);
  return Response.json(result, { status: result.created ? 201 : 200 });
});
