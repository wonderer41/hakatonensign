import { errorResponse } from "@/lib/api/http";
import { isAllowed, type AccessList } from "./access-list";
import type { DenialLog } from "./denial-log";
import { normalizeIp } from "./ip";

export const FORBIDDEN_MESSAGE = "This client address is not allowed to use the dashboard";

/** The 403 sent to refused clients, in the project's error envelope. */
export function forbiddenResponse(): Response {
  return errorResponse("FORBIDDEN", FORBIDDEN_MESSAGE);
}

/**
 * True when the peer may continue; false (and the refusal logged) when it must get the 403.
 * Takes only the TCP peer address on purpose: request headers are never consulted or logged.
 */
export type AclGate = (peerAddress: string | null | undefined) => boolean;

export function createAclGate(list: AccessList, denials: DenialLog): AclGate {
  return (peerAddress) => {
    if (isAllowed(peerAddress, list)) return true;
    denials.record(normalizeIp(peerAddress) ?? "unknown");
    return false;
  };
}
