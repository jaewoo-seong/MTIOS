import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
};

export const projectStatus = pgEnum("project_status", ["active", "paused", "completed", "archived"]);
export const agendaStatus = pgEnum("agenda_status", ["queued", "working", "blocked", "review", "completed"]);
export const agendaWorkType = pgEnum("agenda_work_type", [
  "research", "marketing", "brainstorming", "content", "data_enrichment",
  "document", "communication", "analysis", "operations", "custom"
]);
export const commandStatus = pgEnum("command_status", [
  "draft", "needs_clarification", "awaiting_confirmation", "confirmed", "planning",
  "executing", "review_required", "completed", "failed", "cancelled"
]);
export const reportStatus = pgEnum("report_status", ["working", "review", "saved"]);
export const reviewStatus = pgEnum("review_status", ["pending", "approved", "revision", "rejected"]);
export const memoryStatus = pgEnum("memory_status", ["proposed", "approved", "rejected"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ...timestamps
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  ...timestamps
});

export const memberships = pgTable("memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: text("role").default("owner").notNull(),
  ...timestamps
}, (table) => [uniqueIndex("membership_org_user").on(table.organizationId, table.userId)]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  context: text("context").default("").notNull(),
  scope: text("scope").default("").notNull(),
  constraints: jsonb("constraints").$type<string[]>().default([]).notNull(),
  budgetCents: bigint("budget_cents", { mode: "number" }),
  permissions: jsonb("permissions").$type<{
    externalSend: "review_required" | "blocked";
    clientDataWrite: "review_required" | "blocked";
    destructiveAction: "review_required" | "blocked";
  }>().default({
    externalSend: "review_required",
    clientDataWrite: "review_required",
    destructiveAction: "review_required"
  }).notNull(),
  reviewGates: jsonb("review_gates").$type<string[]>().default([]).notNull(),
  outputRequirements: jsonb("output_requirements").$type<string[]>().default([]).notNull(),
  status: projectStatus("status").default("active").notNull(),
  ...timestamps
});

export const projectMemory = pgTable("project_memory", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  sourceId: uuid("source_id"),
  approved: boolean("approved").default(false).notNull(),
  ...timestamps
});

export const agendas = pgTable("agendas", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  instruction: text("instruction").notNull(),
  workType: agendaWorkType("work_type").default("custom").notNull(),
  status: agendaStatus("status").default("queued").notNull(),
  revision: integer("revision").default(1).notNull(),
  ...timestamps
});

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  description: text("description").default("").notNull(),
  status: text("status").default("queued").notNull(),
  assignedAgentId: uuid("assigned_agent_id").references(() => agentDefinitions.id, { onDelete: "set null" }),
  dependsOn: jsonb("depends_on").$type<string[]>().default([]).notNull(),
  toolScopes: jsonb("tool_scopes").$type<string[]>().default([]).notNull(),
  outputSchema: jsonb("output_schema").$type<Record<string, unknown>>().default({}).notNull(),
  budgetCents: bigint("budget_cents", { mode: "number" }),
  reviewRequired: boolean("review_required").default(false).notNull(),
  ...timestamps
});

export const milestones = pgTable("milestones", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  description: text("description").default("").notNull(),
  status: text("status").default("planned").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  position: integer("position").default(0).notNull(),
  ...timestamps
});

export const projectRecords = pgTable("project_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  status: text("status").default("open").notNull(),
  sourceRunId: uuid("source_run_id").references(() => runs.id, { onDelete: "set null" }),
  ...timestamps
});

export const commands = pgTable("commands", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  page: text("page").notNull(),
  instruction: text("instruction").notNull(),
  status: commandStatus("status").default("draft").notNull(),
  clarification: text("clarification"),
  context: jsonb("context").$type<Record<string, unknown>>().default({}).notNull(),
  idempotencyKey: text("idempotency_key").unique(),
  ...timestamps
});

export const commandRevisions = pgTable("command_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  commandId: uuid("command_id").references(() => commands.id, { onDelete: "cascade" }).notNull(),
  instruction: text("instruction").notNull(),
  clarificationAnswer: text("clarification_answer"),
  context: jsonb("context").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const runs = pgTable("runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  commandId: uuid("command_id").references(() => commands.id, { onDelete: "cascade" }).notNull(),
  triggerRunId: text("trigger_run_id"),
  status: text("status").default("queued").notNull(),
  progress: integer("progress").default(0).notNull(),
  modelRoute: text("model_route").default("executive_reasoning").notNull(),
  costMicros: bigint("cost_micros", { mode: "number" }).default(0).notNull(),
  ...timestamps
});

export const runEvents = pgTable("run_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }).notNull(),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex("run_event_sequence").on(table.runId, table.sequence)]);

export const modelCalls = pgTable("model_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }).notNull(),
  route: text("route").notNull(),
  provider: text("provider"),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  costMicros: bigint("cost_micros", { mode: "number" }).default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const toolCalls = pgTable("tool_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }).notNull(),
  tool: text("tool").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().default({}).notNull(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  summary: text("summary").default("").notNull(),
  content: text("content").default("").notNull(),
  status: reportStatus("status").default("working").notNull(),
  revision: integer("revision").default(1).notNull(),
  ...timestamps
});

export const deliverables = pgTable("deliverables", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  type: text("type").default("report").notNull(),
  status: text("status").default("planned").notNull(),
  reviewRequired: boolean("review_required").default(false).notNull(),
  reportId: uuid("report_id").references(() => reports.id, { onDelete: "set null" }),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  ...timestamps
});

export const agentDefinitions = pgTable("agent_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  modelRoute: text("model_route").notNull(),
  capabilities: jsonb("capabilities").$type<string[]>().default([]).notNull(),
  toolScopes: jsonb("tool_scopes").$type<string[]>().default([]).notNull(),
  budgetCents: bigint("budget_cents", { mode: "number" }),
  outputSchema: jsonb("output_schema").$type<Record<string, unknown>>().default({}).notNull(),
  reviewRequired: boolean("review_required").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps
});

export const documentFolders = pgTable("document_folders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  system: boolean("system").default(false).notNull(),
  position: integer("position").default(0).notNull(),
  ...timestamps
}, (table) => [uniqueIndex("document_folder_org_name").on(table.organizationId, table.name)]);

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  folderId: uuid("folder_id").references(() => documentFolders.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").default("application/octet-stream").notNull(),
  sourceKind: text("source_kind").default("unknown").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).default(0).notNull(),
  pageCount: integer("page_count"),
  wordCount: integer("word_count").default(0).notNull(),
  markdown: text("markdown").default("").notNull(),
  storageKey: text("storage_key"),
  ...timestamps
});

export const storageObjects = pgTable("storage_objects", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  reportId: uuid("report_id").references(() => reports.id, { onDelete: "set null" }),
  key: text("key").notNull().unique(),
  contentType: text("content_type").notNull(),
  size: bigint("size", { mode: "number" }).default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  status: reviewStatus("status").default("pending").notNull(),
  reason: text("reason"),
  ...timestamps
});

export const knowledgeEntries = pgTable("knowledge_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  collection: text("collection").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: memoryStatus("status").default("proposed").notNull(),
  source: text("source"),
  confidence: integer("confidence"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  ...timestamps
});

export const contextSources = pgTable("context_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  title: text("title").notNull(),
  language: text("language").default("unknown").notNull(),
  authority: text("authority").default("working").notNull(),
  approvalStatus: text("approval_status").default("working").notNull(),
  contentHash: text("content_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("context_source_identity").on(table.organizationId, table.sourceType, table.sourceId)
]);

export const contextChunks = pgTable("context_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").references(() => contextSources.id, { onDelete: "cascade" }).notNull(),
  ordinal: integer("ordinal").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  language: text("language").default("unknown").notNull(),
  tokenEstimate: integer("token_estimate").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  embeddingRoute: text("embedding_route"),
  ...timestamps
}, (table) => [
  uniqueIndex("context_chunk_source_ordinal").on(table.sourceId, table.ordinal)
]);

export const contextPacks = pgTable("context_packs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "set null" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  commandId: uuid("command_id").references(() => commands.id, { onDelete: "set null" }),
  query: text("query").notNull(),
  queryLanguage: text("query_language").default("unknown").notNull(),
  tokenBudget: integer("token_budget").notNull(),
  tokenCount: integer("token_count").default(0).notNull(),
  embeddingRoute: text("embedding_route").default("multilingual_embedding").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const contextPackItems = pgTable("context_pack_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  packId: uuid("pack_id").references(() => contextPacks.id, { onDelete: "cascade" }).notNull(),
  chunkId: uuid("chunk_id").references(() => contextChunks.id, { onDelete: "cascade" }).notNull(),
  rank: integer("rank").notNull(),
  scoreMicros: integer("score_micros").notNull(),
  citation: text("citation").notNull(),
  tokenCount: integer("token_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("context_pack_chunk").on(table.packId, table.chunkId)
]);

export const clientDatabases = pgTable("client_databases", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description").default("").notNull(),
  schema: jsonb("schema").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
});

export const clientRecords = pgTable("client_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  databaseId: uuid("database_id").references(() => clientDatabases.id, { onDelete: "cascade" }).notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
  fingerprint: text("fingerprint"),
  ...timestamps
});

export const activityLogs = pgTable("activity_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
