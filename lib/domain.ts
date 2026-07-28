export type CommandStatus =
  | "draft"
  | "needs_clarification"
  | "awaiting_confirmation"
  | "confirmed"
  | "planning"
  | "executing"
  | "review_required"
  | "completed"
  | "failed"
  | "cancelled";

export type ProjectStatus = "active" | "paused" | "completed" | "archived";
export type AgendaStatus = "queued" | "working" | "blocked" | "review" | "completed";
export type ReportStatus = "working" | "review" | "saved";

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  objective: string;
  context: string;
  scope: string;
  constraints: string[];
  budgetCents: number | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Agenda {
  id: string;
  projectId: string;
  title: string;
  instruction: string;
  status: AgendaStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutiveCommand {
  id: string;
  organizationId: string;
  projectId: string | null;
  page: string;
  instruction: string;
  status: CommandStatus;
  clarification: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  message: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  commandId: string;
  projectId: string | null;
  status: "queued" | "planning" | "executing" | "review_required" | "completed" | "failed" | "cancelled";
  workflowRunId: string | null;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewDecision {
  id: string;
  reviewId: string;
  decision: "approved" | "rejected" | "changes_requested";
  note: string;
  createdAt: string;
}

export interface Report {
  id: string;
  projectId: string | null;
  title: string;
  summary: string;
  content: string;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEntry {
  id: string;
  collection: string;
  title: string;
  content: string;
  status: "proposed" | "approved" | "rejected";
  source: string | null;
  createdAt: string;
}

export interface ClientDatabase {
  id: string;
  name: string;
  description: string;
  recordCount: number;
  createdAt: string;
}
