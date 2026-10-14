import { withErrorHandling } from "@/lib/api/http";
import { fetchPendingRequests } from "@/lib/integrations/seerr/pending";

export const GET = withErrorHandling(async () => Response.json({ data: await fetchPendingRequests() }));
