import { HttpError } from "@/lib/api/http";
import type {
  GitHubActivity,
  GitHubCommit,
  GitHubIssue,
  GitHubPullRequest,
} from "./types";

const GITHUB_API = "https://api.github.com";
const PER_PAGE = 30;

function repositoryPath(owner: string, repo: string): string {
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function get<T>(path: string): Promise<T> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, { headers, cache: "no-store" });
  } catch {
    throw new HttpError("UPSTREAM_ERROR", "GitHub API could not be reached");
  }

  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (response.status === 429 || (response.status === 403 && remaining === "0")) {
      throw new HttpError("RATE_LIMITED", "GitHub API rate limit exceeded");
    }
    throw new HttpError(
      "UPSTREAM_ERROR",
      `GitHub API request failed with status ${response.status}`,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new HttpError("UPSTREAM_ERROR", "GitHub API returned invalid JSON");
  }
}

export async function fetchGitHubActivity(owner: string, repo: string): Promise<GitHubActivity> {
  const path = repositoryPath(owner, repo);
  const [commits, pullRequests, issues] = await Promise.all([
    get<GitHubCommit[]>(`/repos/${path}/commits?per_page=${PER_PAGE}`),
    get<GitHubPullRequest[]>(`/repos/${path}/pulls?state=all&sort=updated&direction=desc&per_page=${PER_PAGE}`),
    get<GitHubIssue[]>(`/repos/${path}/issues?state=all&sort=updated&direction=desc&per_page=${PER_PAGE}`),
  ]);

  return { commits, pullRequests, issues: issues.filter((issue) => !("pull_request" in issue)) };
}
