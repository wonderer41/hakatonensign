import { isPlainObject } from "@/lib/api/validate";
import { addDays, formatClock, localDateString } from "@/lib/time/zone";

/** The parts of a WorkCard the collapsed card's meta line is built from. */
export interface MetaLineCard {
  repoFullName: string | null;
  /** The card's `meta` JSON: `meta.github` is written by the GitHub sync, `meta.note` by Hermes. */
  meta: unknown;
}

interface GithubMeta {
  lastCommitAt: Date | null;
  weeklyCommits: number;
}

function readGithubMeta(meta: unknown): GithubMeta | null {
  if (!isPlainObject(meta) || !isPlainObject(meta.github)) return null;
  const { lastCommitAt, weeklyCommits } = meta.github;
  const commitDate = typeof lastCommitAt === "string" ? new Date(lastCommitAt) : null;
  return {
    lastCommitAt: commitDate && !Number.isNaN(commitDate.getTime()) ? commitDate : null,
    weeklyCommits: typeof weeklyCommits === "number" && Number.isInteger(weeklyCommits) && weeklyCommits > 0 ? weeklyCommits : 0,
  };
}

function readNote(meta: unknown): string | null {
  if (!isPlainObject(meta) || typeof meta.note !== "string") return null;
  const note = meta.note.replace(/\s+/g, " ").trim();
  return note || null;
}

function lastCommitText(commit: Date, now: Date, timeZone: string): string {
  const commitDay = localDateString(commit, timeZone);
  const today = localDateString(now, timeZone);
  // A commit stamped slightly ahead of the clock (skew) still counts as today.
  if (commitDay >= today) return formatClock(commit, timeZone);
  if (commitDay >= addDays(today, -6)) {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(commit);
    return `${weekday} ${formatClock(commit, timeZone)}`;
  }
  // The year only appears when it is not the current one, so "Oct 3" is never ambiguous.
  const sameYear = commitDay.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(commit);
}

/**
 * The one-line meta shown on a collapsed Working-on card,
 * with times in the dashboard zone:
 *   `last commit 10:31 · 6 this week`        commit today
 *   `last commit Mon 10:31 · none this week`  commit in the last 6 days
 *   `last commit Oct 3 · none this week`      older
 *   `no commits yet · design phase`           repo without commits (or not synced yet) + meta.note
 * A card with neither a repo nor a note has no meta line (null).
 */
export function formatMetaLine(card: MetaLineCard, now: Date, timeZone: string): string | null {
  const parts: string[] = [];
  if (card.repoFullName?.trim()) {
    const github = readGithubMeta(card.meta);
    if (github?.lastCommitAt) {
      parts.push(`last commit ${lastCommitText(github.lastCommitAt, now, timeZone)}`);
      parts.push(github.weeklyCommits > 0 ? `${github.weeklyCommits} this week` : "none this week");
    } else {
      parts.push("no commits yet");
    }
  }
  const note = readNote(card.meta);
  if (note) parts.push(note);
  return parts.length > 0 ? parts.join(" · ") : null;
}
