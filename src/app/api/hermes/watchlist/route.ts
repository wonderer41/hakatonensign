import { readJsonBody } from "@/lib/api/http";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseWatchlist } from "@/lib/hermes/parse";
import { getWatchlist, setWatchlist } from "@/lib/hermes/watchlist";

// D9: the stocks banner's symbols, in banner order.
export const GET = withHermesAuth(async () => Response.json({ data: await getWatchlist() }));

// Replaces the whole list; when it changed, the banner is refreshed before the response.
export const PUT = withHermesAuth(async (request: Request) => {
  const { symbols } = parseWatchlist(await readJsonBody(request));
  return Response.json(await setWatchlist(symbols));
});
