import type { ValidatedEventInput } from "@/lib/api/validation";
import type { JiraIssue } from "./client";
import type { JiraConfig } from "./config";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function fieldText(fields: Record<string, unknown>, name: string, fallback: string): string {
  return text(fields[name], fallback);
}

export function normalizeJiraIssue(projectId: string, config: JiraConfig, issue: JiraIssue): ValidatedEventInput {
  const fields = issue.fields;
  const status = record(fields.status);
  const statusCategory = record(status.statusCategory);
  const priority = record(fields.priority);
  const assignee = record(fields.assignee);
  const issueType = record(fields.issuetype);
  const title = fieldText(fields, "summary", issue.key);
  const statusName = fieldText(status, "name", "Unknown");
  const statusCategoryKey = fieldText(statusCategory, "key", "").toLowerCase();
  const updatedAt = text(fields.updated, text(fields.created, new Date().toISOString()));
  const parsedUpdatedAt = new Date(updatedAt);
  if (Number.isNaN(parsedUpdatedAt.getTime())) throw new Error(`Jira issue ${issue.key} has an invalid updated timestamp`);
  const isDone = statusCategoryKey === "done";
  const action = isDone ? "issue_closed" : "issue_updated";

  const metadata: Record<string, unknown> = {
    repository: config.projectKey,
    issueKey: issue.key,
    jiraIssueId: issue.id,
    title,
    status: statusName,
    priority: text(priority.name, "Unknown"),
    assignee: text(assignee.displayName, text(assignee.emailAddress, "Unassigned")),
    issueType: text(issueType.name, "Unknown"),
    updatedAt,
  };
  if (statusCategoryKey) metadata.statusCategory = statusCategoryKey;
  if (typeof fields.created === "string") metadata.createdAt = fields.created;
  if (typeof fields.resolutiondate === "string") metadata.resolutionDate = fields.resolutiondate;

  return {
    projectId,
    source: "jira",
    externalId: `jira:${config.projectKey}:${issue.key}`,
    timestamp: parsedUpdatedAt.toISOString(),
    actor: text(assignee.displayName, text(assignee.emailAddress, "jira")),
    action,
    summary: `Jira ${issue.key}: ${title} [${statusName}]`,
    sourceUrl: `${config.baseUrl}/browse/${encodeURIComponent(issue.key)}`,
    metadata,
  };
}

export function normalizeJiraIssues(projectId: string, config: JiraConfig, issues: JiraIssue[]): ValidatedEventInput[] {
  return issues.map((issue) => normalizeJiraIssue(projectId, config, issue));
}
