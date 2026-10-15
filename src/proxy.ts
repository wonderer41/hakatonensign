import { NextResponse, type NextRequest } from "next/server";
import { checkHost, checkStateChange, parseAllowedHosts } from "@/lib/acl/request-origin";
import { errorResponse } from "@/lib/api/http";

// Runs before every page and API route, in development and production alike (unlike the
// client-IP allowlist, which lives in scripts/server.ts because it needs the TCP peer).
// Rules in src/lib/acl/request-origin.ts: same-origin writes only, and an optional host list.

const allowedHosts = parseAllowedHosts(process.env.DASHBOARD_ALLOWED_HOSTS);

export function proxy(request: NextRequest): NextResponse | Response {
  const host = request.headers.get("host");
  if (!checkHost(host, allowedHosts)) {
    return errorResponse("FORBIDDEN", "This host name is not allowed for the dashboard");
  }
  const verdict = checkStateChange({
    method: request.method,
    pathname: request.nextUrl.pathname,
    host,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  });
  if (!verdict.allowed) {
    console.warn(`[origin] refused ${request.method} ${request.nextUrl.pathname} (${verdict.reason})`);
    return errorResponse("FORBIDDEN", "Cross-site requests are not allowed");
  }
  return NextResponse.next();
}

export const config = {
  // Static assets carry no state and no secrets; everything else is checked.
  matcher: ["/((?!_next/static|_next/image|backgrounds/).*)"],
};
