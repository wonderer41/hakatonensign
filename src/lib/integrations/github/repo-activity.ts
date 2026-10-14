import { HttpError } from "@/lib/api/http";

// Read-only GitHub calls behind the card meta line. Separate from client.ts (the hackathon sync):
// this one takes the token and fetch as arguments so tests never touch the network.

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;
const PER_PAGE = 100;
const MAX_COMMIT_PAGES = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NAME_PART = /^[A-Za-z0-9._-]+$/;

type FetchLike = typeof fetch;

export interface RepoActivity {
  defaultBranch: string;
  /** ISO time of the newest commit on the default branch (committer date); null for an empty repository. */
  lastCommitAt: string | null;
  /** Commits on the default branch in the last 7 days, counted up to MAX_COMMIT_PAGES * PER_PAGE. */
  weeklyCommits: number;
}

/** `owner/repo` → its two parts, or null when the text could not name a GitHub repository. */
export function parseRepoFullName(value: string): { owner: string; repo: string } | null {
  const parts = value.trim().split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  const valid = (part: string) => NAME_PART.test(part) && part !== "." && part !== "..";
  return valid(owner) && valid(repo) ? { owner, repo } : null;
}

interface Reply {
  status: number;
  body: unknown;
  /** URL from the Link header's rel="next", when GitHub has another page. */
  next: URL | null;
}

function nextLink(header: string | null): URL | null {
  const match = header ? /<([^>]+)>\s*;\s*rel="next"/.exec(header) : null;
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    // The token only ever goes to GitHub's API host, whatever a header says.
    return url.origin === GITHUB_API ? url : null;
  } catch {
    return null;
  }
}

function failureFor(repo: string, response: Response): HttpError {
  const { status } = response;
  const rateLimited = status === 429 || (status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")));
  if (rateLimited) return new HttpError("RATE_LIMITED", `GitHub rate limit exceeded while reading ${repo}`);
  if (status === 404) return new HttpError("NOT_FOUND", `${repo} was not found, or GITHUB_TOKEN can't read it`);
  if (status === 401) return new HttpError("UPSTREAM_ERROR", "GitHub rejected GITHUB_TOKEN (401)");
  if (status === 403) return new HttpError("UPSTREAM_ERROR", `GitHub denied access to ${repo} (403); check the token's repository access and permissions`);
  return new HttpError("UPSTREAM_ERROR", `GitHub returned HTTP ${status} for ${repo}`);
}

async function get(url: URL, repo: string, token: string, fetchImpl: FetchLike, okStatuses: readonly number[] = []): Promise<Reply> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new HttpError("UPSTREAM_ERROR", timedOut ? `GitHub did not answer within ${REQUEST_TIMEOUT_MS / 1000} s for ${repo}` : `GitHub could not be reached for ${repo}`);
  }
  if (!response.ok) {
    await response.text().catch(() => ""); // free the connection; GitHub's error text is not passed on
    if (!okStatuses.includes(response.status)) throw failureFor(repo, response);
    return { status: response.status, body: null, next: null };
  }
  try {
    return { status: response.status, body: await response.json(), next: nextLink(response.headers.get("link")) };
  } catch {
    throw new HttpError("UPSTREAM_ERROR", `GitHub returned invalid JSON for ${repo}`);
  }
}

function committedAt(commit: unknown): number | null {
  const details = (commit as { commit?: { committer?: { date?: unknown }; author?: { date?: unknown } } } | null)?.commit;
  const raw = details?.committer?.date ?? details?.author?.date;
  const time = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
  return Number.isNaN(time) ? null : time;
}

/** Commits of a branch, newest first as GitHub lists them. A 409 means the repository is empty. */
async function listCommits(url: URL, repo: string, token: string, fetchImpl: FetchLike, maxPages: number): Promise<unknown[]> {
  const commits: unknown[] = [];
  let page: URL | null = url;
  for (let fetched = 0; page && fetched < maxPages; fetched += 1) {
    const reply: Reply = await get(page, repo, token, fetchImpl, [409]);
    if (reply.status === 409) return [];
    if (!Array.isArray(reply.body)) throw new HttpError("UPSTREAM_ERROR", `GitHub returned a malformed commit list for ${repo}`);
    commits.push(...reply.body);
    page = reply.next;
  }
  return commits;
}

/**
 * Default branch, newest commit and the last 7 days' commit count for one repository.
 * Two calls when the week has commits; three when it has none (the newest commit ever is then fetched on its own).
 */
export async function fetchRepoActivity(repoFullName: string, token: string, now: Date, fetchImpl: FetchLike = fetch): Promise<RepoActivity> {
  const name = parseRepoFullName(repoFullName);
  if (!name) throw new HttpError("VALIDATION_ERROR", `"${repoFullName}" is not an owner/repo name`);
  const repoPath = `${GITHUB_API}/repos/${encodeURIComponent(name.owner)}/${encodeURIComponent(name.repo)}`;

  const repository = (await get(new URL(repoPath), repoFullName, token, fetchImpl)).body as { default_branch?: unknown } | null;
  const defaultBranch = typeof repository?.default_branch === "string" ? repository.default_branch : "";
  if (!defaultBranch) throw new HttpError("UPSTREAM_ERROR", `GitHub returned no default branch for ${repoFullName}`);

  const week = new URL(`${repoPath}/commits`);
  week.searchParams.set("sha", defaultBranch);
  week.searchParams.set("since", new Date(now.getTime() - WEEK_MS).toISOString());
  week.searchParams.set("per_page", String(PER_PAGE));
  const recent = await listCommits(week, repoFullName, token, fetchImpl, MAX_COMMIT_PAGES);

  let newest = recent.map(committedAt).filter((time): time is number => time !== null).reduce<number | null>((max, time) => (max === null || time > max ? time : max), null);
  if (recent.length === 0) {
    const latest = new URL(`${repoPath}/commits`);
    latest.searchParams.set("sha", defaultBranch);
    latest.searchParams.set("per_page", "1");
    newest = (await listCommits(latest, repoFullName, token, fetchImpl, 1)).map(committedAt).find((time) => time !== null) ?? null;
  }

  return {
    defaultBranch,
    lastCommitAt: newest === null ? null : new Date(newest).toISOString(),
    weeklyCommits: recent.length,
  };
}
