export interface GitHubUser {
  login?: string;
  name?: string | null;
}

export interface GitHubCommit {
  sha: string;
  html_url?: string;
  author?: GitHubUser | null;
  committer?: GitHubUser | null;
  commit: {
    message: string;
    author?: { name?: string; date?: string } | null;
    committer?: { name?: string; date?: string } | null;
  };
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  user?: GitHubUser | null;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  merged_by?: GitHubUser | null;
}

export interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  user?: GitHubUser | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface GitHubActivity {
  commits: GitHubCommit[];
  pullRequests: GitHubPullRequest[];
  issues: GitHubIssue[];
}
