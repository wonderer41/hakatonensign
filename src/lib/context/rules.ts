import type { ContextItem, ContextSummary, WorkEvent } from "@/types/contracts";

// Deterministic "Resume My Work" summary (contract section 4F):
// - every item cites the events it is based on;
// - "completed" only comes from explicit merged/closed/done events, never commits;
// - blockers are only reported when an event says so;
// - nextSteps are suggestions derived from open items, not assignments.

const MAX_ITEMS_PER_LIST = 8;
const MAX_EVIDENCE_PER_ITEM = 5;
const DONE_STATUSES = new Set(["done", "completed", "complete", "closed", "resolved"]);
const BLOCKED_STATUSES = new Set(["blocked", "on_hold", "on hold"]);
const BLOCKER_TEXT = /\b(block(ed|er|ing)?|waiting (for|on)|stuck)\b/i;
const MAIN_BRANCHES = new Set(["main", "master", "develop", "dev"]);

type Kind = "pr" | "issue" | "task";

interface WorkItem {
  kind: Kind;
  label: string;
  title: string | null;
  state: "open" | "done";
  blocked: boolean;
  review: "approved" | "changes_requested" | "commented" | null;
  branch: string | null;
  events: WorkEvent[]; // oldest first
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return str(value);
}

function hasBlockedLabel(event: WorkEvent): boolean {
  if (event.metadata.blocked === true) return true;
  const labels = event.metadata.labels;
  return (
    Array.isArray(labels) &&
    labels.some((label) => typeof label === "string" && /^block(ed|er)$/i.test(label))
  );
}

// Groups related events (e.g. PR #42 opened, reviewed, merged) under one key.
// Prefers metadata, falls back to the stable externalId format
// "github:<owner>/<repo>:pr:<n>:<action>".
function workItemKey(event: WorkEvent): { kind: Kind; key: string; label: string } | null {
  const { metadata: m, action } = event;
  const container =
    str(m.repository) ??
    str(m.project) ??
    event.externalId?.match(/^[^:]+:([^:]+):/)?.[1] ??
    "";
  const scope = `${event.source}:${container}`;

  if (action.startsWith("pr_")) {
    const n = num(m.prNumber) ?? event.externalId?.match(/:pr:(\d+)/)?.[1] ?? null;
    if (n) return { kind: "pr", key: `${scope}:pr:${n}`, label: `PR #${n}` };
  }
  if (action.startsWith("issue_")) {
    const jiraKey = str(m.issueKey);
    if (jiraKey) return { kind: "issue", key: `${scope}:issue:${jiraKey}`, label: jiraKey };
    const n = num(m.issueNumber) ?? event.externalId?.match(/:issue:([^:]+)/)?.[1] ?? null;
    if (n) return { kind: "issue", key: `${scope}:issue:${n}`, label: `Issue #${n}` };
  }
  if (action === "task_updated") {
    const id = num(m.taskId) ?? str(m.issueKey);
    if (id) return { kind: "task", key: `${scope}:task:${id}`, label: `Task ${id}` };
  }
  return null;
}

function applyEvent(item: WorkItem, event: WorkEvent): void {
  const m = event.metadata;
  item.events.push(event);
  item.title = str(m.title) ?? item.title;
  item.branch = str(m.branch) ?? item.branch;
  if (hasBlockedLabel(event)) item.blocked = true;

  switch (event.action) {
    case "pr_opened":
    case "issue_opened":
    case "issue_updated":
      item.state = "open";
      break;
    case "pr_merged":
    case "issue_closed":
      item.state = "done";
      item.blocked = false;
      break;
    case "pr_reviewed": {
      const state = str(m.state)?.toLowerCase();
      item.review =
        state === "approved"
          ? "approved"
          : state === "changes_requested"
            ? "changes_requested"
            : "commented";
      break;
    }
    case "task_updated": {
      const status = str(m.status)?.toLowerCase() ?? "";
      item.state = DONE_STATUSES.has(status) ? "done" : "open";
      item.blocked = BLOCKED_STATUSES.has(status) || hasBlockedLabel(event);
      break;
    }
  }
}

function evidence(events: WorkEvent[]): string[] {
  return events
    .slice(-MAX_EVIDENCE_PER_ITEM)
    .reverse()
    .map((event) => event.id);
}

function describe(item: WorkItem, status: string): string {
  return item.title ? `${item.label} ${status}: ${item.title}` : `${item.label} ${status}`;
}

function lastTimestamp(events: WorkEvent[]): string {
  return events[events.length - 1].timestamp;
}

interface Ranked extends ContextItem {
  at: string;
}

function finalize(list: Ranked[]): ContextItem[] {
  return list
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_ITEMS_PER_LIST)
    .map(({ text, evidenceEventIds }) => ({ text, evidenceEventIds }));
}

export function buildRulesContext(
  projectId: string,
  events: WorkEvent[],
  activityCount: number,
  now: Date = new Date(),
): ContextSummary {
  const chronological = [...events].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
  );

  const items = new Map<string, WorkItem>();
  const commitsByBranch = new Map<string, WorkEvent[]>();
  const knownBranches = new Set<string>();
  const completed: Ranked[] = [];
  const inProgress: Ranked[] = [];
  const blockers: Ranked[] = [];
  const nextSteps: Ranked[] = [];

  for (const event of chronological) {
    const ref = workItemKey(event);
    if (ref) {
      let item = items.get(ref.key);
      if (!item) {
        item = {
          kind: ref.kind,
          label: ref.label,
          title: null,
          state: "open",
          blocked: false,
          review: null,
          branch: null,
          events: [],
        };
        items.set(ref.key, item);
      }
      applyEvent(item, event);
      continue;
    }

    // Events that cannot be tied to a PR/issue/task stand on their own.
    const cite = { evidenceEventIds: [event.id], at: event.timestamp };
    switch (event.action) {
      case "commit_pushed": {
        // Group by branch when known, otherwise by repository. Only a real branch
        // name can drive the "open a PR" suggestion below.
        const branch = str(event.metadata.branch);
        const group = branch ?? str(event.metadata.repository) ?? "unknown branch";
        commitsByBranch.set(group, [...(commitsByBranch.get(group) ?? []), event]);
        if (branch) knownBranches.add(branch);
        break;
      }
      case "pr_merged":
      case "issue_closed":
        completed.push({ text: event.summary, ...cite });
        break;
      case "note_added":
        if (BLOCKER_TEXT.test(event.summary) || hasBlockedLabel(event)) {
          blockers.push({ text: `Noted by ${event.actor}: ${event.summary}`, ...cite });
          nextSteps.push({ text: `Follow up on: ${event.summary}`, ...cite });
        } else {
          inProgress.push({ text: `Note from ${event.actor}: ${event.summary}`, ...cite });
        }
        break;
      default:
        if (hasBlockedLabel(event)) {
          blockers.push({ text: event.summary, ...cite });
        } else {
          inProgress.push({ text: event.summary, ...cite });
        }
    }
  }

  const branchesWithPr = new Set<string>();
  for (const item of items.values()) {
    const cite = { evidenceEventIds: evidence(item.events), at: lastTimestamp(item.events) };
    if (item.kind === "pr" && item.branch) branchesWithPr.add(item.branch);

    if (item.state === "done") {
      completed.push({
        text: describe(item, item.kind === "pr" ? "was merged" : "was closed"),
        ...cite,
      });
      continue;
    }

    if (item.blocked) {
      blockers.push({ text: describe(item, "is marked as blocked"), ...cite });
      nextSteps.push({ text: `Unblock ${item.label}`, ...cite });
    }

    if (item.kind === "pr") {
      if (item.review === "changes_requested") {
        inProgress.push({ text: describe(item, "is open with changes requested"), ...cite });
        nextSteps.push({ text: `Address requested changes on ${item.label}`, ...cite });
      } else if (item.review === "approved") {
        inProgress.push({ text: describe(item, "is open and approved"), ...cite });
        nextSteps.push({ text: `Merge ${item.label}`, ...cite });
      } else {
        inProgress.push({ text: describe(item, "is open"), ...cite });
        nextSteps.push({ text: `Review the open ${item.label}`, ...cite });
      }
    } else {
      inProgress.push({ text: describe(item, "is open"), ...cite });
      if (!item.blocked) nextSteps.push({ text: `Continue work on ${item.label}`, ...cite });
    }
  }

  for (const [branch, commits] of commitsByBranch) {
    const latest = commits[commits.length - 1];
    const cite = { evidenceEventIds: evidence(commits), at: latest.timestamp };
    const count = commits.length === 1 ? "1 commit" : `${commits.length} commits`;
    const latestText = latest.summary.replace(/^Pushed commit\s+/i, "");
    inProgress.push({ text: `${count} pushed to ${branch} (latest: ${latestText})`, ...cite });
    if (knownBranches.has(branch) && !MAIN_BRANCHES.has(branch) && !branchesWithPr.has(branch)) {
      nextSteps.push({ text: `Consider opening a PR for ${branch}`, ...cite });
    }
  }

  return {
    projectId,
    generatedAt: now.toISOString(),
    completed: finalize(completed),
    inProgress: finalize(inProgress),
    blockers: finalize(blockers),
    nextSteps: finalize(nextSteps),
    activityCount,
    mode: "rules",
  };
}
