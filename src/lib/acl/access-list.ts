import { formatIp, parseIp, parsePeerAddress, type IpFamily, type ParsedIp } from "./ip";

export const ALLOWED_CIDRS_ENV = "DASHBOARD_ALLOWED_CIDRS";

export interface CidrRule {
  family: IpFamily;
  /** Network address, host bits zero. */
  bytes: number[];
  prefix: number;
  /** Canonical form for logs, e.g. "192.168.1.0/24". */
  text: string;
}

export interface AccessList {
  /** True when DASHBOARD_ALLOWED_CIDRS is empty or unset: every client is allowed. */
  allowAll: boolean;
  rules: CidrRule[];
}

const PREFIX_PATTERN = /^\d{1,3}$/;

function invalidEntry(entry: string, reason: string): Error {
  return new Error(`${ALLOWED_CIDRS_ENV}: "${entry}" ${reason}`);
}

function maskBytes(bytes: number[], prefix: number): number[] {
  return bytes.map((byte, index) => {
    const bitsKept = Math.min(8, Math.max(0, prefix - index * 8));
    return byte & ((0xff << (8 - bitsKept)) & 0xff);
  });
}

function parseEntry(entry: string): CidrRule {
  const slash = entry.indexOf("/");
  const addressText = slash === -1 ? entry : entry.slice(0, slash);
  const address = parseIp(addressText);
  if (!address) {
    throw invalidEntry(entry, "is not an IPv4/IPv6 address or CIDR (e.g. 192.168.1.0/24, 192.168.1.10 or fd00::/8)");
  }
  if (address.family === 4 && addressText.includes(":")) {
    throw invalidEntry(entry, "is an IPv4-mapped IPv6 address; write it as plain IPv4 (e.g. 192.168.1.0/24)");
  }

  const maxPrefix = address.family === 4 ? 32 : 128;
  let prefix = maxPrefix;
  if (slash !== -1) {
    const prefixText = entry.slice(slash + 1);
    prefix = PREFIX_PATTERN.test(prefixText) ? Number(prefixText) : NaN;
    if (!(prefix >= 0 && prefix <= maxPrefix)) {
      throw invalidEntry(entry, `has an invalid prefix length (IPv${address.family} allows /0 to /${maxPrefix})`);
    }
  }

  const bytes = maskBytes(address.bytes, prefix);
  const network = formatIp({ family: address.family, bytes });
  // Refuse host bits instead of masking them: "192.168.1.0/2" (a typo for /24) would otherwise
  // silently allow 192.0.0.0/2.
  if (bytes.some((byte, index) => byte !== address.bytes[index])) {
    throw invalidEntry(entry, `has host bits set; did you mean ${network}/${prefix}?`);
  }
  return { family: address.family, bytes, prefix, text: `${network}/${prefix}` };
}

/**
 * Parses a comma-separated list of IPv4/IPv6 addresses and CIDRs. Blank entries are skipped.
 * Throws on the first bad entry, naming it.
 */
export function parseCidrs(value: string | undefined): CidrRule[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(parseEntry);
}

/** Reads DASHBOARD_ALLOWED_CIDRS. Throws (naming the entry) when an entry is invalid. */
export function loadAccessList(env: NodeJS.ProcessEnv = process.env): AccessList {
  const rules = parseCidrs(env[ALLOWED_CIDRS_ENV]);
  return { allowAll: rules.length === 0, rules };
}

/** 127.0.0.0/8 and ::1 (IPv4-mapped loopback arrives here already as IPv4). */
export function isLoopback(ip: ParsedIp): boolean {
  if (ip.family === 4) return ip.bytes[0] === 127;
  return ip.bytes.every((byte, index) => byte === (index === 15 ? 1 : 0));
}

export function matchesRule(ip: ParsedIp, rule: CidrRule): boolean {
  if (ip.family !== rule.family) return false;
  return maskBytes(ip.bytes, rule.prefix).every((byte, index) => byte === rule.bytes[index]);
}

/**
 * Decides on the direct TCP peer address only (req.socket.remoteAddress); never pass
 * X-Forwarded-For or X-Real-IP here, a client can send any value in them.
 * Loopback is always allowed; an address that does not parse is refused.
 */
export function isAllowed(peerAddress: string | null | undefined, list: AccessList): boolean {
  if (list.allowAll) return true;
  const ip = parsePeerAddress(peerAddress);
  if (!ip) return false;
  return isLoopback(ip) || list.rules.some((rule) => matchesRule(ip, rule));
}

export interface StartupLine {
  level: "warn" | "info";
  message: string;
}

/** The one line logged when the server starts. Unset NODE_ENV counts as production. */
export function describeAccessList(list: AccessList, nodeEnv: string | undefined): StartupLine {
  if (list.allowAll) {
    if (nodeEnv === "development" || nodeEnv === "test") {
      return { level: "info", message: `[acl] ${ALLOWED_CIDRS_ENV} is not set; every client is allowed (${nodeEnv})` };
    }
    return { level: "warn", message: `[acl] ${ALLOWED_CIDRS_ENV} is not set; every client is allowed` };
  }
  return {
    level: "info",
    message: `[acl] allowing loopback and ${list.rules.map((rule) => rule.text).join(", ")}`,
  };
}
