import { HttpError } from "@/lib/api/http";
import { isPlainObject } from "@/lib/api/validate";
import { prisma } from "@/lib/db/prisma";
import { mergeMeta } from "@/lib/dashboard/json";
import { publishLiveEvent } from "@/lib/live/publish";
import { safeErrorMessage } from "@/lib/live/redact";
import type { LiveEvent } from "@/types/dashboard-contracts";
import { fetchRepoActivity, type RepoActivity } from "./repo-activity";

// GitHub → the collapsed card's meta line (decision D7: GitHub is read-only). Only cards that carry
// a repoFullName are touched; matching pushes to checklist items is Hermes's job, not this sync's.

/** Stored at `WorkCard.meta.github`. Machine-owned: written here, never by users or Hermes. */
export interface GithubCardMeta extends RepoActivity {
  /** ISO time of the last successful sync of this card. */
  syncedAt: string;
}

export interface CardToSync {
  id: string;
  repoFullName: string;
  meta: unknown;
}

export interface CardMetaStore {
  /** Non-archived cards with a repoFullName, in page order. */
  listCards(): Promise<CardToSync[]>;
  /**
   * Sets `meta.github` and `lastActivityAt` (= github.lastCommitAt) without touching the other meta
   * keys or `version`. `changed` also bumps `updatedAt`; a pure syncedAt refresh leaves it alone.
   */
  saveGithubMeta(cardId: string, github: GithubCardMeta, changed: boolean, now: Date): Promise<void>;
}

export interface CardMetaOutcome {
  cardId: string;
  repoFullName: string;
  /** The card's meta after this run; for a failed card, what it held before. */
  meta: Record<string, unknown>;
}

export interface CardMetaFailure extends CardMetaOutcome {
  message: string;
}

export interface CardMetaSyncResult {
  /** meta.github changed (new, or a different branch, last commit or weekly count). */
  updated: CardMetaOutcome[];
  /** Same data as before; only syncedAt moved. */
  unchanged: CardMetaOutcome[];
  failed: CardMetaFailure[];
}

export interface CardMetaDeps {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  store?: CardMetaStore;
  publish?: (event: LiveEvent) => Promise<void>;
}

function loadGithubToken(env: NodeJS.ProcessEnv): string {
  const token = env.GITHUB_TOKEN?.trim() ?? "";
  if (!token) throw new HttpError("UPSTREAM_ERROR", "GITHUB_TOKEN is not configured");
  return token;
}

function storedGithub(meta: unknown): Partial<RepoActivity> | null {
  return isPlainObject(meta) && isPlainObject(meta.github) ? (meta.github as Partial<RepoActivity>) : null;
}

function sameActivity(before: Partial<RepoActivity> | null, after: RepoActivity): boolean {
  return (
    before !== null &&
    before.defaultBranch === after.defaultBranch &&
    before.lastCommitAt === after.lastCommitAt &&
    before.weeklyCommits === after.weeklyCommits
  );
}

const prismaStore: CardMetaStore = {
  async listCards() {
    const rows = await prisma.workCard.findMany({
      where: { status: { not: "archived" }, repoFullName: { not: null } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, repoFullName: true, meta: true },
    });
    return rows.flatMap((row) => (row.repoFullName?.trim() ? [{ id: row.id, repoFullName: row.repoFullName.trim(), meta: row.meta }] : []));
  },

  async saveGithubMeta(cardId, github, changed, now) {
    // One statement, so a Hermes meta merge that lands while GitHub is being read is never overwritten
    // with a stale copy of the other keys. Explicit casts: Prisma's Date parameters are not tied to a column type here.
    const lastActivityAt = github.lastCommitAt;
    await prisma.$executeRaw`
      UPDATE "WorkCard"
      SET "meta" = jsonb_set(
            CASE WHEN jsonb_typeof("meta") = 'object' THEN "meta" ELSE '{}'::jsonb END,
            '{github}', ${JSON.stringify(github)}::jsonb, true),
          "lastActivityAt" = (${lastActivityAt}::timestamptz AT TIME ZONE 'UTC'),
          "updatedAt" = CASE WHEN ${changed}::boolean THEN (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC') ELSE "updatedAt" END
      WHERE "id" = ${cardId}::uuid`;
  },
};

/**
 * Refreshes `meta.github` and `lastActivityAt` of every card with a repo, from the repo's default
 * branch. `version` is never bumped (machine-owned data), and `card.upserted` is published only for
 * cards whose data changed. One repo failing is recorded and the others still run. Throws only when
 * there are cards to sync but GITHUB_TOKEN is missing.
 */
export async function syncGithubCardMeta(now: Date, deps: CardMetaDeps = {}): Promise<CardMetaSyncResult> {
  const store = deps.store ?? prismaStore;
  const publish = deps.publish ?? publishLiveEvent;
  const result: CardMetaSyncResult = { updated: [], unchanged: [], failed: [] };

  const cards = await store.listCards();
  if (cards.length === 0) return result;
  const token = loadGithubToken(deps.env ?? process.env);
  const fetchImpl = deps.fetch ?? fetch;

  // Cards that point at the same repo share one set of GitHub calls.
  const lookups = new Map<string, Promise<RepoActivity>>();
  for (const card of cards) {
    const outcome = { cardId: card.id, repoFullName: card.repoFullName, meta: isPlainObject(card.meta) ? card.meta : {} };
    try {
      const key = card.repoFullName.toLowerCase();
      let lookup = lookups.get(key);
      if (!lookup) {
        lookup = fetchRepoActivity(card.repoFullName, token, now, fetchImpl);
        lookups.set(key, lookup);
      }
      const activity = await lookup;
      const github: GithubCardMeta = { ...activity, syncedAt: now.toISOString() };
      const changed = !sameActivity(storedGithub(card.meta), activity);
      await store.saveGithubMeta(card.id, github, changed, now);
      const saved = { ...outcome, meta: mergeMeta(card.meta, { github }) };
      if (changed) {
        result.updated.push(saved);
        await publish({ type: "card.upserted", cardId: card.id });
      } else {
        result.unchanged.push(saved);
      }
    } catch (error) {
      result.failed.push({ ...outcome, message: safeErrorMessage(error) });
    }
  }
  return result;
}

/** `updated 1 · unchanged 2 · failed 0`, with the reasons appended when something failed. */
export function formatCardMetaResult(result: CardMetaSyncResult): string {
  const { updated, unchanged, failed } = result;
  if (updated.length + unchanged.length + failed.length === 0) return "no cards with repos";
  const counts = `updated ${updated.length} · unchanged ${unchanged.length} · failed ${failed.length}`;
  return failed.length === 0 ? counts : `${counts} (${failed.map((entry) => `${entry.repoFullName}: ${entry.message}`).join("; ")})`;
}

/** The worker job: sync once and return the log summary. Throws when every card failed (token revoked, GitHub down). */
export async function runGithubCardMetaJob(now: Date, deps: CardMetaDeps = {}): Promise<string> {
  const result = await syncGithubCardMeta(now, deps);
  const summary = formatCardMetaResult(result);
  if (result.failed.length > 0 && result.updated.length + result.unchanged.length === 0) {
    throw new HttpError("UPSTREAM_ERROR", summary);
  }
  return summary;
}
