import { HttpError } from "@/lib/api/http";
import type { JiraConfig } from "./config";

const PAGE_SIZE = 50;
const MAX_ISSUES = 500;

interface JiraSearchResponse {
  issues?: unknown;
  nextPageToken?: unknown;
  isLast?: unknown;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseMessage(status: number): string {
  if (status === 401 || status === 403) return "Jira authentication failed or access was denied";
  if (status === 429) return "Jira API rate limit exceeded";
  if (status >= 500) return "Jira API is unavailable";
  return `Jira API request failed with status ${status}`;
}

async function searchPage(
  config: JiraConfig,
  jql: string,
  nextPageToken?: string,
): Promise<JiraSearchResponse> {
  const body: Record<string, unknown> = {
    jql,
    maxResults: PAGE_SIZE,
    fields: ["summary", "status", "priority", "assignee", "created", "updated", "resolutiondate", "issuetype"],
  };
  if (nextPageToken) body.nextPageToken = nextPageToken;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/rest/api/3/search/jql`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new HttpError("UPSTREAM_ERROR", "Jira API could not be reached");
  }

  if (!response.ok) throw new HttpError(response.status === 429 ? "RATE_LIMITED" : response.status === 401 || response.status === 403 ? "UNAUTHORIZED" : "UPSTREAM_ERROR", responseMessage(response.status));

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError("UPSTREAM_ERROR", "Jira API returned invalid JSON");
  }
  if (!isRecord(payload)) throw new HttpError("UPSTREAM_ERROR", "Jira API returned an invalid search response");
  return payload as JiraSearchResponse;
}

function parseIssues(value: unknown): JiraIssue[] {
  if (!Array.isArray(value)) throw new HttpError("UPSTREAM_ERROR", "Jira API returned an invalid issue list");
  return value.map((raw: unknown) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.key !== "string" || !isRecord(raw.fields)) {
      throw new HttpError("UPSTREAM_ERROR", "Jira API returned a malformed issue");
    }
    return { id: raw.id, key: raw.key, fields: raw.fields };
  });
}

export async function fetchJiraIssues(config: JiraConfig): Promise<JiraIssue[]> {
  const jql = `project = ${config.projectKey} ORDER BY updated DESC`;
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;

  while (issues.length < MAX_ISSUES) {
    const page = await searchPage(config, jql, nextPageToken);
    const pageIssues = parseIssues(page.issues);
    issues.push(...pageIssues);
    if (page.isLast === true || pageIssues.length === 0 || typeof page.nextPageToken !== "string") break;
    nextPageToken = page.nextPageToken;
  }
  return issues.slice(0, MAX_ISSUES);
}

export async function verifyJiraConnection(config: JiraConfig): Promise<void> {
  await searchPage(config, `project = ${config.projectKey}`, undefined);
}
