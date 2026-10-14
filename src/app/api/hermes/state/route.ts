import { getHermesState } from "@/lib/dashboard/state";
import { withHermesAuth } from "@/lib/hermes/auth";

export const GET = withHermesAuth(async () => Response.json(await getHermesState()));
