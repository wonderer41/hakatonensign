import type { WorkEvent } from "@/types/contracts";
import { syncGitHubRepository, type GitHubSyncRunResult } from "./sync";
import type { GitHubAutoSyncConfig } from "./config";

export interface GitHubAutoSyncOptions {
  config: GitHubAutoSyncConfig;
  onNewEvents: (events: WorkEvent[], result: GitHubSyncRunResult) => Promise<void>;
  sync?: () => Promise<GitHubSyncRunResult>;
  log?: (message: string) => void;
}

export class GitHubAutoSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeRun: Promise<void> | null = null;
  private stopped = false;
  private baselineEstablished = false;
  private readonly sync: () => Promise<GitHubSyncRunResult>;

  constructor(private readonly options: GitHubAutoSyncOptions) {
    this.sync = options.sync ?? (() => syncGitHubRepository(
      options.config.projectId,
      options.config.owner,
      options.config.repo,
    ));
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.options.config.intervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.activeRun;
  }

  async runOnce(): Promise<void> {
    if (this.stopped || this.activeRun) return;
    const run = this.performRun();
    this.activeRun = run;
    try {
      await run;
    } catch (error) {
      this.options.log?.(error instanceof Error ? error.message : "GitHub auto-sync callback failed");
    } finally {
      if (this.activeRun === run) this.activeRun = null;
    }
  }

  private async performRun(): Promise<void> {
    let result: GitHubSyncRunResult;
    try {
      result = await this.sync();
    } catch (error) {
      this.options.log?.(error instanceof Error ? error.message : "GitHub auto-sync failed");
      return;
    }

    if (!this.baselineEstablished) {
      this.baselineEstablished = true;
      this.options.log?.(
        `GitHub auto-sync baseline established (${result.created} events seen)`,
      );
      return;
    }
    if (result.createdEvents.length > 0) {
      await this.options.onNewEvents(result.createdEvents, result);
    }
  }
}
