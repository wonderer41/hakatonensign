import { archiveCard } from "@/lib/dashboard/cards";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseKeyParam } from "@/lib/hermes/keys";
import { parseNoInput, readOptionalJsonBody } from "@/lib/hermes/parse";

export const POST = withHermesAuth(async (request: Request, context: { params: Promise<{ key: string }> }) => {
  const card = parseKeyParam((await context.params).key, "card", "key");
  parseNoInput(await readOptionalJsonBody(request));
  return Response.json(await archiveCard(card));
});
