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
export type AgendaWorkType =
  | "research"
  | "marketing"
  | "brainstorming"
  | "content"
  | "data_enrichment"
  | "document"
  | "communication"
  | "analysis"
  | "operations"
  | "custom";
export type ReportStatus = "working" | "review" | "saved";
export type ProjectRecordKind = "decision" | "assumption" | "question";
export type ProjectRecordStatus = "open" | "accepted" | "resolved" | "superseded";

export interface ProjectPermissions {
  externalSend: "review_required" | "blocked";
  clientDataWrite: "review_required" | "blocked";
  destructiveAction: "review_required" | "blocked";
}

export interface CommandContext extends Record<string, unknown> {
  page: string;
  projectId?: string | null;
  agendaId?: string | null;
  agendaBudgetCents?: number | null;
  documentId?: string | null;
  knowledgeEntryId?: string | null;
  clientDatabaseId?: string | null;
  selectedRecordIds?: string[];
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  objective: string;
  context: string;
  scope: string;
  constraints: string[];
  budgetCents: number | null;
  budgetCurrency: "USD" | "KRW";
  permissions: ProjectPermissions;
  reviewGates: string[];
  outputRequirements: string[];
  outputLanguage: "en" | "ko" | "bilingual";
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Agenda {
  id: string;
  projectId: string;
  title: string;
  instruction: string;
  workType: AgendaWorkType;
  status: AgendaStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: "planned" | "active" | "completed" | "missed";
  dueAt: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  projectId: string;
  agendaId: string | null;
  kind: ProjectRecordKind;
  content: string;
  status: ProjectRecordStatus;
  sourceRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deliverable {
  id: string;
  projectId: string;
  agendaId: string | null;
  runId: string | null;
  title: string;
  type: string;
  status: "planned" | "working" | "review" | "completed";
  reviewRequired: boolean;
  reportId: string | null;
  documentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkTask {
  id: string;
  agendaId: string;
  title: string;
  description: string;
  status: string;
  assignedAgentId: string | null;
  dependsOn: string[];
  toolScopes: string[];
  outputSchema: Record<string, unknown>;
  budgetCents: number | null;
  reviewRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDefinition {
  id: string;
  organizationId: string;
  name: string;
  role: "executive" | "worker" | "reviewer";
  modelRoute: string;
  capabilities: AgendaWorkType[];
  toolScopes: string[];
  budgetCents: number | null;
  outputSchema: Record<string, unknown>;
  reviewRequired: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ContextLanguage = "en" | "ko" | "mixed" | "unknown";
export type ContextAuthority = "authoritative" | "approved" | "working" | "external";

export interface ContextSource {
  id: string;
  organizationId: string;
  projectId: string | null;
  agendaId: string | null;
  sourceType:
    | "project"
    | "agenda"
    | "document"
    | "report"
    | "knowledge"
    | "client_record"
    | "brand_profile"
    | "marketing_campaign";
  sourceId: string;
  title: string;
  language: ContextLanguage;
  authority: ContextAuthority;
  approvalStatus: "approved" | "working" | "proposed" | "rejected";
  contentHash: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContextChunk {
  id: string;
  sourceId: string;
  ordinal: number;
  content: string;
  contentHash: string;
  language: ContextLanguage;
  tokenEstimate: number;
  embedding: number[] | null;
  embeddingRoute: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContextCitation {
  packItemId: string;
  chunkId: string;
  sourceType: ContextSource["sourceType"];
  sourceId: string;
  title: string;
  language: ContextLanguage;
  content: string;
  score: number;
  citation: string;
  tokenCount: number;
}

export interface ContextPack {
  id: string;
  organizationId: string;
  projectId: string | null;
  agendaId: string | null;
  taskId: string | null;
  runId: string | null;
  commandId: string | null;
  query: string;
  queryLanguage: ContextLanguage;
  tokenBudget: number;
  tokenCount: number;
  embeddingRoute: string;
  contentHash: string;
  citations: ContextCitation[];
  createdAt: string;
}

export interface ExecutiveCommand {
  id: string;
  organizationId: string;
  projectId: string | null;
  page: string;
  instruction: string;
  status: CommandStatus;
  clarification: string | null;
  context: CommandContext;
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

export type DocumentSourceKind =
  | "pdf"
  | "docx"
  | "html"
  | "csv"
  | "markdown"
  | "text"
  | "json"
  | "gmail_attachment"
  | "unknown";

export interface DocumentFolder {
  id: string;
  name: string;
  system: boolean;
  documentCount: number;
  createdAt: string;
}

export interface WorkspaceDocument {
  id: string;
  folderId: string;
  projectId: string | null;
  title: string;
  filename: string;
  mimeType: string;
  sourceKind: DocumentSourceKind;
  sizeBytes: number;
  pageCount: number | null;
  wordCount: number;
  storageKey: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A document plus its converted markdown body — only fetched when a document is opened. */
export interface WorkspaceDocumentDetail extends WorkspaceDocument {
  markdown: string;
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
  projectId: string | null;
  name: string;
  description: string;
  recordCount: number;
  createdAt: string;
}

export interface ClientRecord {
  id: string;
  databaseId: string;
  /** Column values keyed by header name — the schema is defined by the import. */
  data: Record<string, string>;
  createdAt: string;
}

export type SearchKind = "document" | "project" | "agenda" | "knowledge" | "database";

export interface SearchHit {
  id: string;
  kind: SearchKind;
  title: string;
  /** Matching text around the first hit, for display under the title. */
  excerpt: string;
  /** Where selecting this hit should navigate to. */
  projectId?: string | null;
  documentId?: string | null;
}
