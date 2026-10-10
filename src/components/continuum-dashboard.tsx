"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  ApiError,
  ContextItem,
  ContextSummary,
  PaginatedEvents,
  Project,
  WorkEvent,
  EventSource,
} from "@/types/contracts";

type IconName =
  | "spark"
  | "grid"
  | "folder"
  | "clock"
  | "arrow"
  | "refresh"
  | "plus"
  | "chevron"
  | "check"
  | "alert"
  | "github"
  | "jira"
  | "manual"
  | "external"
  | "layers"
  | "target";

function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "spark":
      return <svg {...common}><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></svg>;
    case "grid":
      return <svg {...common}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></svg>;
    case "folder":
      return <svg {...common}><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" /><path d="M3.5 10h17" /></svg>;
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></svg>;
    case "arrow":
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "refresh":
      return <svg {...common}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2" /></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "chevron":
      return <svg {...common}><path d="m7 10 5 5 5-5" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case "alert":
      return <svg {...common}><path d="M12 3.8 21 20H3l9-16.2Z" /><path d="M12 9v4.5M12 17h.01" /></svg>;
    case "github":
      return <svg {...common}><path d="M9 19c-4.5 1.4-4.5-2.3-6.3-2.8M15 21v-3.5a3 3 0 0 0-.8-2.3c2.7-.3 5.5-1.3 5.5-6A4.7 4.7 0 0 0 18.4 6a4.3 4.3 0 0 0-.1-3.2S17.3 2.5 15 4a12.5 12.5 0 0 0-6 0C6.7 2.5 5.7 2.8 5.7 2.8A4.3 4.3 0 0 0 5.6 6a4.7 4.7 0 0 0-1.3 3.3c0 4.7 2.8 5.7 5.5 6A3 3 0 0 0 9 17.5V21" /></svg>;
    case "jira":
      return <svg {...common}><path d="M12 3 4 11l8 8 8-8-8-8Z" /><path d="m8 7 8 8M6 13l5 5" /></svg>;
    case "manual":
      return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" /></svg>;
    case "external":
      return <svg {...common}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>;
    case "layers":
      return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></svg>;
    case "target":
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="m12 12 6-6" /></svg>;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiError = body as ApiError | null;
    throw new Error(apiError?.error?.message ?? "Something went wrong. Please try again.");
  }
  return body as T;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sourceLabel(source: EventSource): string {
  return source === "github" ? "GitHub" : source === "jira" ? "Jira" : "Manual";
}

function sourceIcon(source: EventSource): IconName {
  return source === "github" ? "github" : source === "jira" ? "jira" : "manual";
}

function eventActionLabel(event: WorkEvent): string {
  const labels: Record<WorkEvent["action"], string> = {
    commit_pushed: "Commit pushed",
    pr_opened: "Pull request opened",
    pr_merged: "Pull request merged",
    pr_reviewed: "Pull request reviewed",
    issue_opened: "Issue opened",
    issue_updated: "Issue updated",
    issue_closed: "Issue closed",
    task_updated: "Task updated",
    note_added: "Note added",
  };
  return labels[event.action];
}

function ContextList({
  items,
  empty,
  tone = "neutral",
}: {
  items: ContextItem[];
  empty: string;
  tone?: "neutral" | "green" | "amber" | "blue";
}) {
  const bulletTone = {
    neutral: "bg-slate-500",
    green: "bg-emerald-400",
    amber: "bg-amber-400",
    blue: "bg-cyan-400",
  }[tone];

  if (items.length === 0) {
    return <p className="py-3 text-sm leading-6 text-slate-500">{empty}</p>;
  }

  return (
    <ul className="space-y-3">
      {items.slice(0, 4).map((item, index) => (
        <li className="flex gap-3" key={`${item.text}-${index}`}>
          <span className={`mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full ${bulletTone}`} />
          <div className="min-w-0">
            <p className="text-sm leading-6 text-slate-200">{item.text}</p>
            {item.evidenceEventIds.length > 0 && (
              <p className="mt-1 text-[11px] font-medium tracking-wide text-slate-500">
                {item.evidenceEventIds.length} {item.evidenceEventIds.length === 1 ? "source" : "sources"}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function MetricCard({
  label,
  value,
  caption,
  icon,
  tone,
}: {
  label: string;
  value: number;
  caption: string;
  icon: IconName;
  tone: "cyan" | "green" | "amber" | "violet";
}) {
  const toneClass = {
    cyan: "metric-icon-cyan",
    green: "metric-icon-green",
    amber: "metric-icon-amber",
    violet: "metric-icon-violet",
  }[tone];

  return (
    <article className="metric-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
        <span className={`metric-icon ${toneClass}`}><Icon name={icon} size={17} /></span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{caption}</p>
    </article>
  );
}

function ActivityRow({ event }: { event: WorkEvent }) {
  return (
    <article className="activity-row">
      <span className={`source-mark source-${event.source}`}>
        <Icon name={sourceIcon(event.source)} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-slate-100">{event.summary}</p>
          <span className="activity-action">{eventActionLabel(event)}</span>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          <span className="font-medium text-slate-400">{event.actor}</span>
          <span className="mx-2 text-slate-700">·</span>
          {sourceLabel(event.source)}
          <span className="mx-2 text-slate-700">·</span>
          <time dateTime={event.timestamp} title={new Date(event.timestamp).toLocaleString()}>
            {formatRelativeTime(event.timestamp)}
          </time>
        </p>
      </div>
      {event.sourceUrl && (
        <a
          aria-label={`Open source for ${event.summary}`}
          className="icon-button ml-2 shrink-0"
          href={event.sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          <Icon name="external" size={16} />
        </a>
      )}
    </article>
  );
}

export default function ContinuumDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectError, setProjectError] = useState("");
  const [projectsRefreshToken, setProjectsRefreshToken] = useState(0);
  const [summary, setSummary] = useState<ContextSummary | null>(null);
  const [eventPage, setEventPage] = useState<PaginatedEvents>({ data: [], nextCursor: null });
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [sourceFilter, setSourceFilter] = useState<"all" | EventSource>("all");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [createError, setCreateError] = useState("");
  const [olderLoading, setOlderLoading] = useState(false);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const isDetailsLoading = detailsLoading || (Boolean(selectedProjectId) && !summary && !detailsError);
  const filteredEvents = useMemo(
    () => eventPage.data.filter((event) => sourceFilter === "all" || event.source === sourceFilter),
    [eventPage.data, sourceFilter],
  );

  useEffect(() => {
    const controller = new AbortController();

    requestJson<{ data: Project[] }>("/api/projects", { signal: controller.signal })
      .then(({ data }) => {
        setProjects(data);
        setProjectError("");
        setSelectedProjectId((current) =>
          data.some((project) => project.id === current) ? current : data[0]?.id ?? "",
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProjectError(error instanceof Error ? error.message : "Could not load projects.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectsLoading(false);
      });

    return () => controller.abort();
  }, [projectsRefreshToken]);

  useEffect(() => {
    if (!selectedProjectId) return;

    const controller = new AbortController();

    Promise.all([
      requestJson<{ data: ContextSummary }>(`/api/context?projectId=${encodeURIComponent(selectedProjectId)}`, {
        signal: controller.signal,
      }),
      requestJson<PaginatedEvents>(`/api/events?projectId=${encodeURIComponent(selectedProjectId)}&limit=20`, {
        signal: controller.signal,
      }),
    ])
      .then(([context, events]) => {
        setSummary(context.data);
        setEventPage(events);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDetailsError(error instanceof Error ? error.message : "Could not load this project.");
        setSummary(null);
        setEventPage({ data: [], nextCursor: null });
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailsLoading(false);
      });

    return () => controller.abort();
  }, [selectedProjectId, refreshToken]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    if (!name) return;

    setCreatingProject(true);
    setCreateError("");
    try {
      const result = await requestJson<{ data: Project }>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...(description ? { description } : {}) }),
      });
      setDetailsLoading(true);
      setDetailsError("");
      setSummary(null);
      setEventPage({ data: [], nextCursor: null });
      setProjects((current) => [result.data, ...current]);
      setSelectedProjectId(result.data.id);
      setShowProjectForm(false);
      form.reset();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create project.");
    } finally {
      setCreatingProject(false);
    }
  }

  function selectProject(projectId: string) {
    if (projectId === selectedProjectId) return;
    setDetailsLoading(true);
    setDetailsError("");
    setSummary(null);
    setEventPage({ data: [], nextCursor: null });
    setSelectedProjectId(projectId);
  }

  function refreshProjectDetails() {
    setDetailsLoading(Boolean(selectedProjectId));
    setDetailsError("");
    setRefreshToken((current) => current + 1);
  }

  async function loadOlderEvents() {
    if (!selectedProjectId || !eventPage.nextCursor || olderLoading) return;
    setOlderLoading(true);
    try {
      const nextPage = await requestJson<PaginatedEvents>(
        `/api/events?projectId=${encodeURIComponent(selectedProjectId)}&limit=20&cursor=${encodeURIComponent(eventPage.nextCursor)}`,
      );
      setEventPage((current) => ({
        data: [...current.data, ...nextPage.data],
        nextCursor: nextPage.nextCursor,
      }));
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : "Could not load older activity.");
    } finally {
      setOlderLoading(false);
    }
  }

  function refreshDashboard() {
    setProjectsLoading(true);
    setProjectError("");
    setDetailsLoading(Boolean(selectedProjectId));
    setDetailsError("");
    setProjectsRefreshToken((current) => current + 1);
    setRefreshToken((current) => current + 1);
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard-layout">
        <aside className="sidebar">
          <a className="brand-lockup" href="#overview" aria-label="Continuum home">
            <span className="brand-symbol"><Icon name="spark" size={20} /></span>
            <span>
              <span className="brand-name">continuum</span>
              <span className="brand-tagline">Your work, connected.</span>
            </span>
          </a>

          <div className="workspace-switcher">
            <span className="workspace-avatar">D</span>
            <span className="min-w-0 flex-1">
              <span className="eyebrow block">Workspace</span>
              <span className="mt-1 block truncate text-sm font-medium text-slate-200">Demo workspace</span>
            </span>
            <Icon name="chevron" size={15} className="text-slate-500" />
          </div>

          <div className="sidebar-section-label">Workspace</div>
          <nav aria-label="Main navigation" className="sidebar-nav">
            <a className="nav-link nav-link-active" href="#overview"><Icon name="grid" size={17} />Overview</a>
            <a className="nav-link" href="#projects"><Icon name="folder" size={17} />Projects</a>
            <a className="nav-link" href="#activity"><Icon name="clock" size={17} />Activity</a>
          </nav>

          <div className="sidebar-project-heading" id="projects">
            <span className="sidebar-section-label !mb-0">Your projects</span>
            <button
              aria-label="Create project"
              className="quiet-icon-button"
              onClick={() => { setShowProjectForm(true); setCreateError(""); }}
              type="button"
            ><Icon name="plus" size={16} /></button>
          </div>
          <div className="sidebar-project-list">
            {projectsLoading ? (
              <div className="sidebar-skeleton" />
            ) : projects.length ? projects.slice(0, 5).map((project) => (
              <button
                className={`project-nav-item ${project.id === selectedProjectId ? "project-nav-selected" : ""}`}
                key={project.id}
                onClick={() => selectProject(project.id)}
                type="button"
              >
                <span className="project-nav-dot" />
                <span className="truncate">{project.name}</span>
              </button>
            )) : (
              <p className="px-3 py-2 text-xs leading-5 text-slate-600">Your projects will appear here.</p>
            )}
          </div>

          <div className="sidebar-bottom">
            <div className="sidebar-tip-icon"><Icon name="layers" size={17} /></div>
            <p className="text-xs font-medium text-slate-300">A little more context.</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">One place to pick up where your work left off.</p>
          </div>
        </aside>

        <section className="dashboard-main" id="overview">
          <header className="topbar">
            <div className="topbar-breadcrumb">
              <span className="breadcrumb-muted">Workspace</span><span className="breadcrumb-divider">/</span>
              <span>{selectedProject?.name ?? "Overview"}</span>
            </div>
            <div className="topbar-actions">
              <span className="connection-pill"><span />Local demo</span>
              <button
                aria-label="Refresh dashboard"
                className="icon-button refresh-button"
                disabled={isDetailsLoading || projectsLoading}
                onClick={refreshDashboard}
                type="button"
              ><Icon name="refresh" size={16} /></button>
              <button className="primary-button topbar-create" onClick={() => { setShowProjectForm(true); setCreateError(""); }} type="button">
                <Icon name="plus" size={16} /> New project
              </button>
            </div>
          </header>

          <div className="page-content">
            <div className="page-heading">
              <div>
                <p className="eyebrow page-eyebrow"><span className="eyebrow-spark"><Icon name="spark" size={13} /></span> YOUR WORK, CONNECTED</p>
                <h1>Good work, in focus.</h1>
                <p className="page-subtitle">Everything moving across your projects, with the context to keep going.</p>
              </div>
              <div className="project-select-wrap">
                <label className="eyebrow" htmlFor="project-select">CURRENT PROJECT</label>
                <div className="project-select-box">
                  <Icon name="folder" size={16} className="text-cyan-300" />
                  <select
                    id="project-select"
                    onChange={(event) => selectProject(event.target.value)}
                    value={selectedProjectId}
                    disabled={!projects.length || projectsLoading}
                  >
                    {projects.length ? projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>) : <option value="">No projects yet</option>}
                  </select>
                  <Icon name="chevron" size={15} className="text-slate-500" />
                </div>
              </div>
            </div>

            {projectError && (
              <div className="notice notice-error" role="alert">
                <Icon name="alert" size={18} />
                <div><p className="font-medium">Couldn’t load your projects</p><p className="mt-1 text-xs text-rose-200/70">{projectError}</p></div>
                <button className="notice-action" onClick={refreshDashboard} type="button">Try again</button>
              </div>
            )}

            {!projectError && !projectsLoading && projects.length === 0 && (
              <section className="empty-project-panel">
                <span className="empty-project-art"><Icon name="folder" size={27} /></span>
                <p className="eyebrow">A FRESH START</p>
                <h2>Give your work a home.</h2>
                <p className="empty-project-copy">Create a project to bring its activity together and build a useful picture of what’s next.</p>
                <button className="primary-button" onClick={() => { setShowProjectForm(true); setCreateError(""); }} type="button"><Icon name="plus" size={16} /> Create your first project</button>
              </section>
            )}

            {(projectsLoading || selectedProject) && (
              <>
                <section className="welcome-card">
                  <div className="welcome-copy">
                    <span className="welcome-orb welcome-orb-one" /><span className="welcome-orb welcome-orb-two" />
                    <p className="welcome-overline"><span className="welcome-dot" /> PROJECT SNAPSHOT</p>
                    <h2>{selectedProject ? selectedProject.name : "Gathering your workspace"}</h2>
                    <p className="welcome-description">
                      {selectedProject?.description || "A clear view of what moved, what’s active, and where to pick things back up."}
                    </p>
                    <a className="welcome-link" href="#resume">Resume your work <Icon name="arrow" size={15} /></a>
                  </div>
                  <div className="welcome-visual" aria-hidden="true">
                    <div className="orbit orbit-outer" /><div className="orbit orbit-inner" />
                    <div className="visual-core"><Icon name="spark" size={25} /></div>
                    <span className="orbit-node node-one"><Icon name="github" size={14} /></span>
                    <span className="orbit-node node-two"><Icon name="check" size={14} /></span>
                    <span className="orbit-node node-three"><Icon name="clock" size={14} /></span>
                  </div>
                  <div className="welcome-footnote">
                    <span className="welcome-footnote-mark"><Icon name="target" size={15} /></span>
                    <span>{summary ? `${summary.activityCount} activities shaping this snapshot` : "Your project activity, in one place"}</span>
                    <span className="footnote-separator" />
                    <span className="rules-label">{summary?.mode === "ai" ? "AI summary" : "Evidence-based"}</span>
                  </div>
                </section>

                {detailsError && (
                  <div className="notice notice-error mt-5" role="alert">
                    <Icon name="alert" size={18} />
                    <div><p className="font-medium">Couldn’t load project activity</p><p className="mt-1 text-xs text-rose-200/70">{detailsError}</p></div>
                    <button className="notice-action" onClick={refreshProjectDetails} type="button">Retry</button>
                  </div>
                )}

                <section aria-label="Project metrics" className="metrics-grid">
                  <MetricCard label="Activity" value={summary?.activityCount ?? 0} caption="events in this project" icon="layers" tone="cyan" />
                  <MetricCard label="In motion" value={summary?.inProgress.length ?? 0} caption="items still moving" icon="target" tone="violet" />
                  <MetricCard label="Needs attention" value={summary?.blockers.length ?? 0} caption="explicitly marked blockers" icon="alert" tone="amber" />
                  <MetricCard label="Completed" value={summary?.completed.length ?? 0} caption="confirmed outcomes" icon="check" tone="green" />
                </section>

                <section className="resume-section" id="resume">
                  <div className="section-heading-row">
                    <div>
                      <p className="eyebrow">CONTEXT, NOT MORE NOISE</p>
                      <h2>Resume my work</h2>
                    </div>
                    <span className="summary-mode"><span />{summary?.mode === "ai" ? "AI assisted" : "Grounded in activity"}</span>
                  </div>

                  <div className="resume-grid">
                    <article className="next-step-card">
                      <div className="next-step-topline"><span className="next-step-icon"><Icon name="arrow" size={16} /></span><span className="eyebrow">A GOOD NEXT STEP</span></div>
                      {isDetailsLoading ? <div className="line-skeleton mt-5" /> : summary?.nextSteps[0] ? (
                        <>
                          <h3>{summary.nextSteps[0].text}</h3>
                          <p className="evidence-note">Suggested from {summary.nextSteps[0].evidenceEventIds.length} recent {summary.nextSteps[0].evidenceEventIds.length === 1 ? "event" : "events"}</p>
                        </>
                      ) : (
                        <><h3>Let the activity lead the way.</h3><p className="evidence-note">Add a few project events to get a grounded next step.</p></>
                      )}
                      <a className="next-step-link" href="#activity">See recent activity <Icon name="arrow" size={14} /></a>
                    </article>

                    <article className="context-card context-card-wide">
                      <div className="context-card-heading"><span className="context-heading-icon icon-cyan"><Icon name="target" size={16} /></span><div><h3>In progress</h3><p>Work that’s still moving</p></div><span className="context-count">{summary?.inProgress.length ?? 0}</span></div>
                      {isDetailsLoading ? <div className="context-skeleton"><i /><i /></div> : <ContextList items={summary?.inProgress ?? []} empty="Nothing active yet. New work will show up here." tone="blue" />}
                    </article>

                    <article className="context-card">
                      <div className="context-card-heading"><span className="context-heading-icon icon-amber"><Icon name="alert" size={16} /></span><div><h3>Blocked</h3><p>Explicitly called out</p></div><span className="context-count">{summary?.blockers.length ?? 0}</span></div>
                      {isDetailsLoading ? <div className="context-skeleton"><i /></div> : <ContextList items={summary?.blockers ?? []} empty="No blockers reported in recent activity." tone="amber" />}
                    </article>

                    <article className="context-card">
                      <div className="context-card-heading"><span className="context-heading-icon icon-green"><Icon name="check" size={16} /></span><div><h3>Completed</h3><p>Confirmed in the activity</p></div><span className="context-count">{summary?.completed.length ?? 0}</span></div>
                      {isDetailsLoading ? <div className="context-skeleton"><i /></div> : <ContextList items={summary?.completed ?? []} empty="Completed work will appear as it’s recorded." tone="green" />}
                    </article>
                  </div>
                </section>

                <section className="activity-section" id="activity">
                  <div className="section-heading-row activity-heading-row">
                    <div><p className="eyebrow">THE LATEST FROM YOUR TOOLS</p><h2>Recent activity</h2></div>
                    <label className="filter-select-wrap"><span className="sr-only">Filter activity by source</span>
                      <select className="filter-select" onChange={(event) => setSourceFilter(event.target.value as "all" | EventSource)} value={sourceFilter}>
                        <option value="all">All sources</option><option value="github">GitHub</option><option value="jira">Jira</option><option value="manual">Manual</option>
                      </select><Icon name="chevron" size={14} />
                    </label>
                  </div>
                  <div className="activity-card">
                    {isDetailsLoading ? (
                      <div className="activity-loading"><i /><i /><i /></div>
                    ) : filteredEvents.length ? (
                      <>
                        <div className="activity-list">{filteredEvents.map((event) => <ActivityRow event={event} key={event.id} />)}</div>
                        {eventPage.nextCursor && sourceFilter === "all" && (
                          <button className="load-older-button" disabled={olderLoading} onClick={loadOlderEvents} type="button">
                            {olderLoading ? "Loading…" : "Load older activity"}<Icon name="arrow" size={14} />
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="activity-empty">
                        <span className="activity-empty-icon"><Icon name="clock" size={19} /></span>
                        <p className="text-sm font-medium text-slate-300">{sourceFilter === "all" ? "The timeline starts here." : `No ${sourceLabel(sourceFilter).toLowerCase()} activity yet.`}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">When work events arrive, they’ll show up here with a link to the source.</p>
                      </div>
                    )}
                  </div>
                </section>

                <footer className="page-footer"><span>Continuum</span><span className="footer-separator" />Context that keeps work moving.</footer>
              </>
            )}
          </div>
        </section>
      </div>

      {showProjectForm && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowProjectForm(false); }}>
          <section aria-labelledby="new-project-title" aria-modal="true" className="project-modal" role="dialog">
            <button aria-label="Close" className="modal-close icon-button" onClick={() => setShowProjectForm(false)} type="button">×</button>
            <span className="modal-icon"><Icon name="folder" size={20} /></span>
            <p className="eyebrow mt-5">MAKE ROOM FOR WHAT’S NEXT</p>
            <h2 id="new-project-title">Create a project</h2>
            <p className="modal-description">A home for the activity and context you’ll want to return to.</p>
            <form className="project-form" onSubmit={createProject}>
              <label htmlFor="project-name">Project name</label>
              <input autoFocus id="project-name" maxLength={120} name="name" placeholder="e.g. Website redesign" required />
              <label htmlFor="project-description">Description <span>Optional</span></label>
              <textarea id="project-description" maxLength={1000} name="description" placeholder="What are you working toward?" rows={3} />
              {createError && <p className="form-error" role="alert">{createError}</p>}
              <div className="modal-actions">
                <button className="secondary-button" onClick={() => setShowProjectForm(false)} type="button">Cancel</button>
                <button className="primary-button" disabled={creatingProject} type="submit">{creatingProject ? "Creating…" : "Create project"}<Icon name="arrow" size={15} /></button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
