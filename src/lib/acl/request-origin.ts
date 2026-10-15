// Browser-side request checks for the login-less dashboard (decision D3). The client-IP allowlist
// (scripts/server.ts) decides WHO may connect; these decide WHERE a browser request came from:
//
// - Cross-site writes: a page on any other site that a device inside the LAN/mesh opens could POST
//   to /api/* from that device's (allowed) address. Browsers label such requests with
//   Sec-Fetch-Site / Origin, so state-changing /api/* calls must be same-origin. /api/hermes/* is
//   machine-to-machine behind a bearer token and is left alone; GET/HEAD/OPTIONS never change state.
// - DNS rebinding: a hostname the attacker controls can be pointed at the dashboard's LAN address,
//   making their page "same-origin" with it. When DASHBOARD_ALLOWED_HOSTS is set, requests for any
//   other hostname are refused (IP literals and localhost are always fine: they cannot be rebound).

export type OriginVerdict = { allowed: true } | { allowed: false; reason: "cross-site" | "origin-mismatch" };

export interface RequestFacts {
  method: string;
  pathname: string;
  /** The Host header as sent (may carry a port). */
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** DASHBOARD_ALLOWED_HOSTS: comma-separated host names (no ports). Empty means every host is accepted. */
export function parseAllowedHosts(raw: string | undefined): string[] {
  const hosts: string[] = [];
  for (const entry of (raw ?? "").split(",")) {
    const host = entry.trim().toLowerCase();
    if (!host) continue;
    if (!HOSTNAME.test(host)) throw new Error(`DASHBOARD_ALLOWED_HOSTS: "${entry.trim()}" is not a host name`);
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/** The lowercase host name from a Host header, without the port ("[::1]:3000" → "::1"). */
export function hostName(hostHeader: string | null | undefined): string | null {
  const raw = hostHeader?.trim().toLowerCase() ?? "";
  if (!raw) return null;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 1 ? raw.slice(1, end) : null;
  }
  const name = raw.split(":")[0];
  return name || null;
}

export function isIpLiteral(name: string): boolean {
  if (name.includes(":")) return true; // IPv6 (already unbracketed)
  return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(name);
}

export function isLocalhostName(name: string): boolean {
  return name === "localhost" || name.endsWith(".localhost");
}

/** True when the request's Host is acceptable: always when no list is configured. */
export function checkHost(hostHeader: string | null | undefined, allowedHosts: readonly string[]): boolean {
  if (allowedHosts.length === 0) return true;
  const name = hostName(hostHeader);
  if (!name) return false;
  if (isIpLiteral(name) || isLocalhostName(name)) return true;
  return allowedHosts.includes(name);
}

/**
 * Refuses state-changing browser requests to /api/* that did not come from this origin.
 * Requests without browser headers (curl, scripts, Hermes) carry neither Sec-Fetch-Site nor Origin
 * and pass; the bearer check and the IP allowlist cover those.
 */
export function checkStateChange(facts: RequestFacts): OriginVerdict {
  if (SAFE_METHODS.has(facts.method.toUpperCase())) return { allowed: true };
  if (!facts.pathname.startsWith("/api/") || facts.pathname.startsWith("/api/hermes/")) return { allowed: true };

  const site = facts.secFetchSite?.trim().toLowerCase();
  if (site) {
    // "none" is a user-initiated navigation, which another site cannot forge.
    if (site === "same-origin" || site === "none") return { allowed: true };
    return { allowed: false, reason: "cross-site" };
  }

  const origin = facts.origin?.trim();
  if (origin === undefined || origin === "") return { allowed: true };
  if (origin.toLowerCase() === "null") return { allowed: false, reason: "cross-site" };
  try {
    const sent = new URL(origin).host.toLowerCase();
    const host = facts.host?.trim().toLowerCase() ?? "";
    if (sent && sent === host) return { allowed: true };
  } catch {
    // Not a URL: fall through to the refusal.
  }
  return { allowed: false, reason: "origin-mismatch" };
}
