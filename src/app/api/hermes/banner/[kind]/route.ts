import { readJsonBody } from "@/lib/api/http";
import { ROOT, invalid, isPlainObject, isoDateTime } from "@/lib/api/validate";
import { insertBannerSnapshot } from "@/lib/dashboard/banner";
import { parseBannerKind } from "@/lib/dashboard/banner-payload";
import { withHermesAuth } from "@/lib/hermes/auth";

// Body: the snapshot payload for :kind plus capturedAt (ISO). Unknown fields are rejected.
export const PUT = withHermesAuth(async (request: Request, context: { params: Promise<{ kind: string }> }) => {
  const kind = parseBannerKind((await context.params).kind);
  const body = await readJsonBody(request);
  if (!isPlainObject(body)) invalid(ROOT, "must be a JSON object");
  const { capturedAt, ...payload } = body;
  const result = await insertBannerSnapshot(kind, payload, new Date(isoDateTime(capturedAt, "capturedAt")), "hermes");
  return Response.json(result, { status: result.created ? 201 : 200 });
});
