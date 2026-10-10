export interface GitHubAutoSyncConfig {
  projectId: string;
  owner: string;
  repo: string;
  intervalMs: number;
}

const REPOSITORY_PART = /^[A-Za-z0-9._-]+$/;
const DEFAULT_INTERVAL_MS = 60_000;

export function loadGitHubAutoSyncConfig(
  env: NodeJS.ProcessEnv = process.env,
  projectId = env.CONTINUUM_DEMO_PROJECT_ID?.trim() ?? "",
): GitHubAutoSyncConfig | null {
  const owner = env.GITHUB_SYNC_OWNER?.trim() ?? "";
  const repo = env.GITHUB_SYNC_REPO?.trim() ?? "";
  if (!owner && !repo) return null;
  if (!owner || !repo) {
    throw new Error("GITHUB_SYNC_OWNER and GITHUB_SYNC_REPO must be configured together");
  }
  if (!projectId) {
    throw new Error("CONTINUUM_DEMO_PROJECT_ID is required for GitHub auto-sync");
  }
  if (!REPOSITORY_PART.test(owner) || !REPOSITORY_PART.test(repo)) {
    throw new Error("GITHUB_SYNC_OWNER and GITHUB_SYNC_REPO contain invalid characters");
  }

  const intervalRaw = env.GITHUB_SYNC_INTERVAL_MS?.trim();
  const intervalMs = intervalRaw ? Number(intervalRaw) : DEFAULT_INTERVAL_MS;
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error("GITHUB_SYNC_INTERVAL_MS must be an integer of at least 1000 milliseconds");
  }
  return { projectId, owner, repo, intervalMs };
}
