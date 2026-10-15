import { formatClock, localDateString } from "@/lib/time/zone";
import type { ChecklistItemDto, SprintDto, WorkCardDto } from "@/types/dashboard-contracts";

/** The card's title: the repo name (without the owner) for repo cards, else the card title. */
export function cardDisplayTitle(card: Pick<WorkCardDto, "title" | "repoFullName">): string {
  const repo = card.repoFullName?.split("/").pop()?.trim();
  return repo || card.title;
}

/** "Seed sprint · 11 days left", "… · 1 day left", "… · last day", or "no active sprint". */
export function sprintLine(sprint: Pick<SprintDto, "name" | "daysLeft"> | null): string {
  if (!sprint) return "no active sprint";
  const { daysLeft } = sprint;
  if (daysLeft === null) return sprint.name;
  if (daysLeft <= 0) return `${sprint.name} · last day`;
  return `${sprint.name} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
}

/** "5 / 8 issues" when every item mirrors an issue number, else "5 / 8 items". */
export function countLine(card: Pick<WorkCardDto, "progress" | "items">): string {
  const noun = card.items.length > 0 && card.items.every((item) => item.issueNumber !== null) ? "issues" : "items";
  return `${card.progress.done} / ${card.progress.total} ${noun}`;
}

export function issueRef(item: Pick<ChecklistItemDto, "issueNumber">): string | null {
  return item.issueNumber === null ? null : `#${item.issueNumber}`;
}

/** "#13 Streak tracking" or just the title. */
export function itemName(item: Pick<ChecklistItemDto, "issueNumber" | "title">): string {
  const ref = issueRef(item);
  return ref ? `${ref} ${item.title}` : item.title;
}

/**
 * The booked time tag: "19:00–20:30", with a short weekday when the block isn't today
 * ("Thu 19:00–20:30"), since `scheduled` is the item's next upcoming block.
 */
export function timeTag(scheduled: NonNullable<ChecklistItemDto["scheduled"]>, now: string, timeZone: string): string {
  const startsAt = new Date(scheduled.startsAt);
  const range = `${formatClock(startsAt, timeZone)}–${formatClock(new Date(scheduled.endsAt), timeZone)}`;
  if (localDateString(startsAt, timeZone) === localDateString(new Date(now), timeZone)) return range;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(startsAt);
  return `${weekday} ${range}`;
}

/** First 7 characters of a commit sha, as GitHub shows it. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
