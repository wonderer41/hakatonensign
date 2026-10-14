import type { LiveEvent } from "@/types/dashboard-contracts";

// Every write that changes what the page shows calls this after its DB commit
// (for-claude/docs/04-API.md, section C). The real fan-out (Postgres LISTEN/NOTIFY,
// decision D12) lands with the worker step; until then events are only logged.
export async function publishLiveEvent(event: LiveEvent): Promise<void> {
  if (process.env.NODE_ENV !== "production") console.debug("[live] publish", event);
}
