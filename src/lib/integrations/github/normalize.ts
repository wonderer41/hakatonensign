import type { ValidatedEventInput } from "@/lib/api/validation";
import type { GitHubActivity, GitHubCommit, GitHubIssue, GitHubPullRequest } from "./types";

function actor(user: { login?: string; name?: string | null } | null | undefined): string {
  return user?.login?.trim() || user?.name?.trim() || "";
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("GitHub returned an invalid timestamp");
  return parsed.toISOString();
}

function repositoryName(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function commitEvent(projectId: string, owner: string, repo: string, commit: GitHubCommit): ValidatedEventInput {
  const message = commit.commit.message.split("\n", 1)[0].trim();
  return {
    projectId,
    source: "github",
    externalId: `github:${repositoryName(owner, repo)}:commit:${commit.sha}`,
    timestamp: timestamp(commit.commit.author?.date ?? commit.commit.committer?.date ?? new Date().toISOString()),
    actor:
      actor(commit.author) ||
      actor(commit.committer) ||
      commit.commit.author?.name?.trim() ||
      commit.commit.committer?.name?.trim() ||
      "github-user",
    action: "commit_pushed",
    summary: `Pushed commit ${commit.sha.slice(0, 7)}${message ? `: ${message}` : ""}`,
    sourceUrl: commit.html_url ?? `https://github.com/${repositoryName(owner, repo)}/commit/${commit.sha}`,
    metadata: { repository: repositoryName(owner, repo), sha: commit.sha },
  };
}

function pullRequestEvents(projectId: string, owner: string, repo: string, pr: GitHubPullRequest): ValidatedEventInput[] {
  const repository = repositoryName(owner, repo);
  const base = {
    projectId,
    source: "github" as const,
    actor: actor(pr.user) || "github-user",
    summary: `Opened PR #${pr.number}: ${pr.title}`,
    sourceUrl: pr.html_url,
    metadata: { repository, prNumber: pr.number },
  };
  const events: ValidatedEventInput[] = [{
    ...base,
    externalId: `github:${repository}:pr:${pr.number}:opened`,
    timestamp: timestamp(pr.created_at),
    action: "pr_opened",
  }];

  if (pr.merged_at) {
    events.push({
      ...base,
      externalId: `github:${repository}:pr:${pr.number}:merged`,
      timestamp: timestamp(pr.merged_at),
      actor: actor(pr.merged_by) || actor(pr.user) || "github-user",
      action: "pr_merged",
      summary: `Merged PR #${pr.number}: ${pr.title}`,
      metadata: { ...base.metadata, merged: true },
    });
  }
  return events;
}

function issueEvents(projectId: string, owner: string, repo: string, issue: GitHubIssue): ValidatedEventInput[] {
  const repository = repositoryName(owner, repo);
  const base = {
    projectId,
    source: "github" as const,
    actor: actor(issue.user) || "github-user",
    sourceUrl: issue.html_url,
    metadata: { repository, issueNumber: issue.number },
  };
  const events: ValidatedEventInput[] = [{
    ...base,
    externalId: `github:${repository}:issue:${issue.number}:opened`,
    timestamp: timestamp(issue.created_at),
    action: "issue_opened",
    summary: `Opened issue #${issue.number}: ${issue.title}`,
  }];

  if (issue.closed_at) {
    events.push({
      ...base,
      externalId: `github:${repository}:issue:${issue.number}:closed`,
      timestamp: timestamp(issue.closed_at),
      action: "issue_closed",
      summary: `Closed issue #${issue.number}: ${issue.title}`,
      metadata: { ...base.metadata, state: "closed" },
    });
  } else if (timestamp(issue.updated_at) !== timestamp(issue.created_at)) {
    events.push({
      ...base,
      externalId: `github:${repository}:issue:${issue.number}:updated:${timestamp(issue.updated_at)}`,
      timestamp: timestamp(issue.updated_at),
      action: "issue_updated",
      summary: `Updated issue #${issue.number}: ${issue.title}`,
      metadata: { ...base.metadata, state: issue.state },
    });
  }
  return events;
}

export function normalizeGitHubActivity(
  projectId: string,
  owner: string,
  repo: string,
  activity: GitHubActivity,
): ValidatedEventInput[] {
  return [
    ...activity.commits.map((commit) => commitEvent(projectId, owner, repo, commit)),
    ...activity.pullRequests.flatMap((pr) => pullRequestEvents(projectId, owner, repo, pr)),
    ...activity.issues.flatMap((issue) => issueEvents(projectId, owner, repo, issue)),
  ];
}
