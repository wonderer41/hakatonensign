import { safeErrorMessage, safeLogText } from "@/lib/live/redact";
import { describeTrigger, formatDuration, type JobTrigger, nextDailyRun, nextIntervalRun, validateTrigger } from "./schedule";

export interface JobContext {
  /** When this run actually started. */
  now: Date;
  /** The planned run time (for daily jobs, exactly the local occurrence, e.g. 00:00:00). */
  scheduledFor: Date;
  /** DASHBOARD_TIME_ZONE. */
  timeZone: string;
}

export interface WorkerJob {
  /** Short kebab-case name used in logs, e.g. "calendar-sync". Must be unique. */
  name: string;
  /**
   * `everyMs`: runs once at start, then on a fixed-rate interval (a tick that arrives while the
   * previous run is still going is skipped). `dailyAt`: runs at that local time every day.
   */
  trigger: JobTrigger;
  /** Does the work. The returned text (counts, not secrets) is appended to the "ok" log line. */
  run: (context: JobContext) => Promise<string | void>;
}

export interface SchedulerOptions {
  timeZone: string;
  log?: (line: string) => void;
  logError?: (line: string) => void;
}

interface JobState {
  job: WorkerJob;
  nextAt: Date | null;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
}

// Timers sleep at most this long and then re-check the wall clock, so clock changes, early timer
// fires or a suspended host never shift a daily job by more than this.
const MAX_SLEEP_MS = 60_000;

/** Small in-process job runner for the worker container. One run per job at a time. */
export class Scheduler {
  private readonly jobs = new Map<string, JobState>();
  private started = false;
  private stopping = false;
  private readonly log: (line: string) => void;
  private readonly logError: (line: string) => void;

  constructor(private readonly options: SchedulerOptions) {
    this.log = options.log ?? ((line) => console.log(line));
    this.logError = options.logError ?? ((line) => console.error(line));
  }

  register(job: WorkerJob): void {
    if (this.started) throw new Error("Register jobs before start()");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(job.name)) throw new Error(`Job name "${job.name}" must be kebab-case`);
    if (this.jobs.has(job.name)) throw new Error(`Job "${job.name}" is registered twice`);
    try {
      validateTrigger(job.trigger);
    } catch (error) {
      throw new Error(`Job "${job.name}": ${error instanceof Error ? error.message : "invalid trigger"}`);
    }
    this.jobs.set(job.name, { job, nextAt: null, timer: null, running: null });
  }

  /** Planned next run per job (null while running or before start). */
  nextRuns(): { name: string; trigger: string; nextAt: Date | null }[] {
    return [...this.jobs.values()].map((state) => ({ name: state.job.name, trigger: describeTrigger(state.job.trigger), nextAt: state.nextAt }));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const now = new Date();
    for (const state of this.jobs.values()) {
      const { trigger } = state.job;
      this.plan(state, "everyMs" in trigger ? now : nextDailyRun(now, trigger.dailyAt, this.options.timeZone));
    }
  }

  /** Stops scheduling, waits for runs in progress to finish. */
  async stop(): Promise<void> {
    this.stopping = true;
    const running: Promise<void>[] = [];
    for (const state of this.jobs.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.nextAt = null;
      if (state.running) running.push(state.running);
    }
    await Promise.allSettled(running);
  }

  private plan(state: JobState, at: Date): void {
    if (this.stopping) return;
    state.nextAt = at;
    this.arm(state);
  }

  private arm(state: JobState): void {
    if (this.stopping || !state.nextAt) return;
    const wait = state.nextAt.getTime() - Date.now();
    if (wait <= 0) {
      state.timer = null;
      this.fire(state);
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = null;
      this.arm(state);
    }, Math.min(wait, MAX_SLEEP_MS));
  }

  private fire(state: JobState): void {
    if (this.stopping || state.running || !state.nextAt) return;
    const scheduledFor = state.nextAt;
    const startedAt = new Date();
    state.nextAt = null;
    state.running = this.execute(state.job, scheduledFor, startedAt).finally(() => {
      state.running = null;
      this.plan(state, this.nextAfterRun(state.job.trigger, scheduledFor, startedAt));
    });
  }

  private nextAfterRun(trigger: JobTrigger, scheduledFor: Date, startedAt: Date): Date {
    const now = new Date();
    try {
      if ("everyMs" in trigger) return nextIntervalRun(startedAt, trigger.everyMs, now);
      return nextDailyRun(new Date(Math.max(now.getTime(), scheduledFor.getTime())), trigger.dailyAt, this.options.timeZone);
    } catch (error) {
      this.logError(`[worker] scheduling failed, retrying in 1m: ${safeErrorMessage(error)}`);
      return new Date(now.getTime() + 60_000);
    }
  }

  private async execute(job: WorkerJob, scheduledFor: Date, startedAt: Date): Promise<void> {
    try {
      const summary = await job.run({ now: startedAt, scheduledFor, timeZone: this.options.timeZone });
      const detail = typeof summary === "string" && summary.trim() ? ` ${safeLogText(summary)}` : "";
      this.log(`[worker] ${job.name} ok ${formatDuration(Date.now() - startedAt.getTime())}${detail}`);
    } catch (error) {
      this.logError(`[worker] ${job.name} failed: ${safeErrorMessage(error)}`);
    }
  }
}
