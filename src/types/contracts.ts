// Shared API contracts. See CONTINUUM_API_CONTRACTS.md, section 3.
// Owned by Backend (Dev 1). Import these types; do not redefine response shapes.

export type EventSource = "github" | "jira" | "google_calendar" | "manual";
export type EventAction =
  | "commit_pushed"
  | "pr_opened"
  | "pr_merged"
  | "pr_reviewed"
  | "issue_opened"
  | "issue_updated"
  | "issue_closed"
  | "task_updated"
  | "note_added";

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkEvent {
  id: string;
  projectId: string;
  source: EventSource;
  externalId: string | null;
  timestamp: string;
  actor: string;
  action: EventAction;
  summary: string;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContextItem {
  text: string;
  evidenceEventIds: string[];
}

export interface ContextSummary {
  projectId: string;
  generatedAt: string;
  completed: ContextItem[];
  inProgress: ContextItem[];
  blockers: ContextItem[];
  nextSteps: ContextItem[];
  activityCount: number;
  mode: "rules" | "ai";
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AiContextResponse {
  answer: string;
  whereWeLeftOff: string;
  nextSteps: string[];
  blockers: string[];
  upcomingMeetings: string[];
  evidenceEventIds: string[];
  confidence: "high" | "medium" | "low";
}

export interface PaginatedEvents {
  data: WorkEvent[];
  nextCursor: string | null;
}

// Additive types for the remaining endpoint shapes in section 4.

export const EVENT_SOURCES: readonly EventSource[] = ["github", "jira", "google_calendar", "manual"];
export const EVENT_ACTIONS: readonly EventAction[] = [
  "commit_pushed",
  "pr_opened",
  "pr_merged",
  "pr_reviewed",
  "issue_opened",
  "issue_updated",
  "issue_closed",
  "task_updated",
  "note_added",
];

export interface CreateProjectRequest {
  name: string;
  description?: string | null;
}

export interface UpdateProjectRequest {
  name: string;
}

export interface CreateEventRequest {
  projectId: string;
  source: EventSource;
  externalId?: string | null;
  timestamp: string;
  actor: string;
  action: EventAction;
  summary: string;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateEventResponse {
  data: WorkEvent;
  created: boolean;
}

export interface GitHubSyncRequest {
  projectId: string;
  owner: string;
  repo: string;
}

export interface GitHubSyncResult {
  projectId: string;
  repository: string;
  fetched: number;
  created: number;
  duplicates: number;
  syncedAt: string;
}

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "UPSTREAM_ERROR"
  | "AI_NOT_CONFIGURED"
  | "AI_PROVIDER_ERROR"
  | "AI_INVALID_RESPONSE"
  | "AI_CONTEXT_EMPTY";
