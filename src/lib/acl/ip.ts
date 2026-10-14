import { isIPv4, isIPv6 } from "node:net";

export type IpFamily = 4 | 6;

/** An address as bytes: 4 of them for IPv4, 16 for IPv6. */
export interface ParsedIp {
  family: IpFamily;
  bytes: number[];
}

// ::ffff:0:0/96 — how a dual-stack socket reports an IPv4 peer (::ffff:192.168.1.5).
const MAPPED_PREFIX = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];

function ipv4Bytes(text: string): number[] | null {
  // node:net rejects leading zeros ("010.0.0.1"), so octal look-alikes never parse.
  return isIPv4(text) ? text.split(".").map(Number) : null;
}

function ipv6Bytes(text: string): number[] | null {
  if (!isIPv6(text) || text.includes("%")) return null;
  let hex = text;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    // Dotted IPv4 tail (::ffff:1.2.3.4) -> two hex groups.
    const v4 = ipv4Bytes(tail);
    if (!v4) return null;
    hex = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const gap = hex.indexOf("::");
  const head = (gap === -1 ? hex : hex.slice(0, gap)).split(":").filter(Boolean);
  const rest = gap === -1 ? [] : hex.slice(gap + 2).split(":").filter(Boolean);
  const zeros = 8 - head.length - rest.length;
  if (gap === -1 ? zeros !== 0 : zeros < 1) return null;
  const groups = [...head, ...Array<string>(gap === -1 ? 0 : zeros).fill("0"), ...rest];
  return groups.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

/**
 * Strict parse of one address as written in config: no brackets, no zone id, no whitespace.
 * IPv4-mapped IPv6 comes back as IPv4.
 */
export function parseIp(text: string): ParsedIp | null {
  const v4 = ipv4Bytes(text);
  if (v4) return { family: 4, bytes: v4 };
  const v6 = ipv6Bytes(text);
  if (!v6) return null;
  if (MAPPED_PREFIX.every((byte, index) => v6[index] === byte)) return { family: 4, bytes: v6.slice(12) };
  return { family: 6, bytes: v6 };
}

/** A socket peer address as ParsedIp. Drops a zone id (fe80::1%eth0); null when it is not an IP. */
export function parsePeerAddress(raw: string | null | undefined): ParsedIp | null {
  if (!raw) return null;
  const zone = raw.indexOf("%");
  return parseIp(zone === -1 ? raw : raw.slice(0, zone));
}

function formatIpv6(bytes: number[]): string {
  const groups = Array.from({ length: 8 }, (_, index) => (bytes[2 * index] << 8) | bytes[2 * index + 1]);
  // RFC 5952: compress the longest run of two or more zero groups (the first one on a tie).
  let bestStart = -1;
  let bestLength = 1;
  for (let start = 0; start < 8; ) {
    if (groups[start] !== 0) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < 8 && groups[end] === 0) end += 1;
    if (end - start > bestLength) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestStart === -1) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

/** Canonical text: dotted IPv4, or lower-case compressed IPv6. */
export function formatIp(ip: ParsedIp): string {
  return ip.family === 4 ? ip.bytes.join(".") : formatIpv6(ip.bytes);
}

/**
 * Canonical text of a peer address, or null when it is not an IP.
 * "::ffff:192.168.1.5" -> "192.168.1.5", "0:0:0:0:0:0:0:1" -> "::1", "fe80::1%eth0" -> "fe80::1".
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  const ip = parsePeerAddress(raw);
  return ip ? formatIp(ip) : null;
}
