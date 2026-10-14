import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { createCard, listCards } from "@/lib/dashboard/user-cards";
import { parseCardQuery, parseCreateCard } from "@/lib/dashboard/user-parse";

export const GET = withErrorHandling(async (request: Request) => {
  const filter = parseCardQuery(new URL(request.url).searchParams);
  return Response.json({ data: await listCards(filter) });
});

export const POST = withErrorHandling(async (request: Request) => {
  const input = parseCreateCard(await readJsonBody(request));
  return Response.json(await createCard(input), { status: 201 });
});
