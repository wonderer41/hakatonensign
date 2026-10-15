import {
  ROOT,
  arrayOf,
  enumValue,
  fieldPath,
  finiteNumber,
  integer,
  invalid,
  isoDateTime,
  optionalHttpUrl,
  requiredString,
  strictObject,
} from "@/lib/api/validate";
import type { BannerKind, GmailSnapshot, OrphansSnapshot, ScanSnapshot, StocksSnapshot } from "@/types/dashboard-contracts";

// Strict validation of banner snapshots against the four interfaces in
// src/types/dashboard-contracts.ts. Unknown fields are rejected at every level, so a Gmail
// payment can never carry an amount and orphans stay names-only.

export const BANNER_KINDS: readonly BannerKind[] = ["gmail", "orphans", "scan", "stocks"];

export type SnapshotPayload = GmailSnapshot | OrphansSnapshot | ScanSnapshot | StocksSnapshot;

const MAX_LIST = 50;
const MAX_ORPHANS = 200;
const MAX_ISSUES = 100;
const MAX_STOCK_ROWS = 50;
const MAX_COUNT = 1_000_000;

function count(value: unknown, field: string): number {
  return integer(value, field, { min: 0, max: MAX_COUNT });
}

function parseGmail(o: Record<string, unknown>): GmailSnapshot {
  return {
    since: isoDateTime(o.since, "since"),
    needsReply: arrayOf(o.needsReply, "needsReply", MAX_LIST, (value, field) => {
      const row = strictObject(value, field, ["from", "subject", "threadUrl"]);
      const threadUrl = optionalHttpUrl(row.threadUrl, fieldPath(field, "threadUrl"));
      return {
        from: requiredString(row.from, fieldPath(field, "from"), 200),
        subject: requiredString(row.subject, fieldPath(field, "subject"), 300),
        ...(threadUrl === undefined ? {} : { threadUrl }),
      };
    }),
    packages: arrayOf(o.packages, "packages", MAX_LIST, (value, field) => {
      const row = strictObject(value, field, ["label", "status"]);
      return {
        label: requiredString(row.label, fieldPath(field, "label"), 200),
        status: requiredString(row.status, fieldPath(field, "status"), 100),
      };
    }),
    payments: arrayOf(o.payments, "payments", MAX_LIST, (value, field) => {
      const row = strictObject(value, field, ["merchant", "at"]);
      return {
        merchant: requiredString(row.merchant, fieldPath(field, "merchant"), 200),
        at: isoDateTime(row.at, fieldPath(field, "at")),
      };
    }),
    deletedCount: count(o.deletedCount, "deletedCount"),
  };
}

function parseOrphans(o: Record<string, unknown>): OrphansSnapshot {
  const counts = strictObject(o.counts, "counts", ["sonarr", "radarr"]);
  return {
    items: arrayOf(o.items, "items", MAX_ORPHANS, (value, field) => {
      const row = strictObject(value, field, ["name", "kind", "arr"]);
      return {
        name: requiredString(row.name, fieldPath(field, "name"), 300),
        kind: enumValue(row.kind, fieldPath(field, "kind"), ["episode", "movie"] as const),
        arr: enumValue(row.arr, fieldPath(field, "arr"), ["sonarr", "radarr"] as const),
      };
    }),
    counts: { sonarr: count(counts.sonarr, "counts.sonarr"), radarr: count(counts.radarr, "counts.radarr") },
  };
}

function parseScan(o: Record<string, unknown>): ScanSnapshot {
  const up = count(o.up, "up");
  const total = count(o.total, "total");
  if (up > total) invalid("up", "must not be greater than total");
  return {
    ranAt: isoDateTime(o.ranAt, "ranAt"),
    up,
    total,
    issues: arrayOf(o.issues, "issues", MAX_ISSUES, (value, field) => {
      const row = strictObject(value, field, ["container", "summary"]);
      return {
        container: requiredString(row.container, fieldPath(field, "container"), 100),
        summary: requiredString(row.summary, fieldPath(field, "summary"), 300),
      };
    }),
  };
}

function parseStocks(o: Record<string, unknown>): StocksSnapshot {
  const rows = arrayOf(o.rows, "rows", MAX_STOCK_ROWS, (value, field) => {
    const row = strictObject(value, field, ["symbol", "price", "currency", "dayChangePct", "sixMonthChangePct"]);
    const price = finiteNumber(row.price, fieldPath(field, "price"));
    if (price < 0) invalid(fieldPath(field, "price"), "must not be negative");
    const currency = requiredString(row.currency, fieldPath(field, "currency"), 3);
    if (!/^[A-Z]{3}$/.test(currency)) invalid(fieldPath(field, "currency"), "must be a 3-letter ISO currency code, e.g. USD");
    return {
      // 16 = WatchlistSymbol.symbol VarChar size.
      symbol: requiredString(row.symbol, fieldPath(field, "symbol"), 16),
      price,
      currency,
      dayChangePct: finiteNumber(row.dayChangePct, fieldPath(field, "dayChangePct")),
      sixMonthChangePct: row.sixMonthChangePct === null ? null : finiteNumber(row.sixMonthChangePct, fieldPath(field, "sixMonthChangePct")),
    };
  });
  if (rows.length === 0) invalid("rows", "must have at least one row");
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (seen.has(row.symbol)) invalid(fieldPath(fieldPath("rows", index), "symbol"), `repeats ${row.symbol}`);
    seen.add(row.symbol);
  });
  return { asOf: isoDateTime(o.asOf, "asOf"), rows };
}

const FIELDS: Record<BannerKind, readonly string[]> = {
  gmail: ["since", "needsReply", "packages", "payments", "deletedCount"],
  orphans: ["items", "counts"],
  scan: ["ranAt", "up", "total", "issues"],
  stocks: ["asOf", "rows"],
};

/** Validates a snapshot payload for `kind`; any field outside that kind's interface is rejected. */
export function parseSnapshotPayload(kind: BannerKind, value: unknown): SnapshotPayload {
  const o = strictObject(value, ROOT, FIELDS[kind]);
  switch (kind) {
    case "gmail":
      return parseGmail(o);
    case "orphans":
      return parseOrphans(o);
    case "scan":
      return parseScan(o);
    case "stocks":
      return parseStocks(o);
  }
}

export function parseBannerKind(value: string): BannerKind {
  return enumValue(value, "kind", BANNER_KINDS);
}
