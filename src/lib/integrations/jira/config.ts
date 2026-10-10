import { HttpError } from "@/lib/api/http";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (!value) throw new HttpError("UPSTREAM_ERROR", `${name} is not configured`);
  return value;
}

export function loadJiraConfig(env: NodeJS.ProcessEnv = process.env): JiraConfig {
  const rawBaseUrl = required(env, "JIRA_BASE_URL").replace(/\/+$/, "");
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new HttpError("UPSTREAM_ERROR", "JIRA_BASE_URL is invalid");
  }
  if (baseUrl.protocol !== "https:") {
    throw new HttpError("UPSTREAM_ERROR", "JIRA_BASE_URL must use HTTPS");
  }

  const projectKey = required(env, "JIRA_PROJECT_KEY");
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(projectKey)) {
    throw new HttpError("UPSTREAM_ERROR", "JIRA_PROJECT_KEY is invalid");
  }

  return {
    baseUrl: baseUrl.toString().replace(/\/+$/, ""),
    email: required(env, "JIRA_EMAIL"),
    apiToken: required(env, "JIRA_API_TOKEN"),
    projectKey,
  };
}
