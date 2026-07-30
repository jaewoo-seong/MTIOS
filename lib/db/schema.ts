import {
  bigint,
  boolean,
  index,
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
  username: text("username").notNull().unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  status: text("status").default("active").notNull(),
  forcePasswordChange: boolean("force_password_change").default(true).notNull(),
  temporaryPasswordExpiresAt: timestamp("temporary_password_expires_at", { withTimezone: true }),
  failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  ...timestamps
});

export const memberships = pgTable("memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: text("role").default("member").notNull(),
  ...timestamps
}, (table) => [uniqueIndex("membership_org_user").on(table.organizationId, table.userId)]);

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("user_session_user_active_idx").on(table.userId, table.revokedAt, table.idleExpiresAt)
]);

export const authenticationEvents = pgTable("authentication_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  username: text("username"),
  email: text("email"),
  event: text("event").notNull(),
  success: boolean("success").default(false).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("authentication_event_user_time_idx").on(table.userId, table.createdAt)]);

export const userPreferences = pgTable("user_preferences", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  locale: text("locale").default("en").notNull(),
  timezone: text("timezone").default("America/Indiana/Indianapolis").notNull(),
  dateFormat: text("date_format").default("medium").notNull(),
  numberFormat: text("number_format").default("locale").notNull(),
  currency: text("currency").default("USD").notNull(),
  ...timestamps
}, (table) => [uniqueIndex("user_preference_org_user").on(table.organizationId, table.userId)]);

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
  budgetCurrency: text("budget_currency").default("USD").notNull(),
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
  outputLanguage: text("output_language").default("en").notNull(),
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
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
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
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
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
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  agentType: text("agent_type"),
  route: text("route").notNull(),
  provider: text("provider"),
  model: text("model"),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  costMicros: bigint("cost_micros", { mode: "number" }).default(0).notNull(),
  latencyMs: integer("latency_ms").default(0).notNull(),
  fallbackReason: text("fallback_reason"),
  licensingStatus: text("licensing_status").default("unverified").notNull(),
  environment: text("environment").default("development").notNull(),
  attemptCount: integer("attempt_count").default(1).notNull(),
  structuredOutputValid: boolean("structured_output_valid"),
  requestBudgetMicros: bigint("request_budget_micros", { mode: "number" }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const providerQuotaPolicies = pgTable("provider_quota_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  provider: text("provider").notNull(),
  route: text("route").default("*").notNull(),
  period: text("period").notNull(),
  allowance: integer("allowance").notNull(),
  timezone: text("timezone").default("UTC").notNull(),
  enforcement: text("enforcement").default("block_and_fallback").notNull(),
  active: boolean("active").default(true).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps
}, (table) => [
  uniqueIndex("provider_quota_policy_scope_idx").on(
    table.organizationId, table.provider, table.route, table.period
  )
]);

export const providerUsageEvents = pgTable("provider_usage_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  modelCallId: uuid("model_call_id").references(() => modelCalls.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model"),
  route: text("route").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  source: text("source").default("observed").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("provider_usage_window_idx").on(table.organizationId, table.provider, table.occurredAt)
]);

export const modelPricingSnapshots = pgTable("model_pricing_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputMicrosPerMillionTokens: bigint("input_micros_per_million_tokens", { mode: "number" }).default(0).notNull(),
  outputMicrosPerMillionTokens: bigint("output_micros_per_million_tokens", { mode: "number" }).default(0).notNull(),
  currency: text("currency").default("USD").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).defaultNow().notNull(),
  source: text("source").default("admin").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("model_pricing_snapshot_idx").on(table.provider, table.model, table.effectiveAt)
]);

export const premiumModelApprovals = pgTable("premium_model_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }).notNull(),
  route: text("route").notNull(),
  proposedProvider: text("proposed_provider").notNull(),
  proposedModel: text("proposed_model").notNull(),
  estimatedInputTokens: integer("estimated_input_tokens").default(0).notNull(),
  estimatedOutputTokens: integer("estimated_output_tokens").default(0).notNull(),
  maximumCostMicros: bigint("maximum_cost_micros", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  status: text("status").default("pending").notNull(),
  requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  resumeToken: text("resume_token").notNull().unique(),
  ...timestamps
}, (table) => [
  uniqueIndex("premium_model_approval_run_route_idx").on(table.runId, table.route)
]);

export const modelRouteRevisions = pgTable("model_route_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  route: text("route").notNull(),
  version: integer("version").notNull(),
  configuration: jsonb("configuration").$type<{
    purpose: string;
    maxCostMicros: number;
    structuredOutput: boolean;
    candidates: Array<{
      provider: "openrouter" | "nvidia";
      modelEnv: string;
      pricingClass: "paid" | "free";
      productionApproved: boolean;
      licensingStatus: "approved" | "testing_only" | "unverified";
    }>;
  }>().notNull(),
  status: text("status").default("draft").notNull(),
  testStatus: text("test_status").default("not_tested").notNull(),
  testError: text("test_error"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  supersedesId: uuid("supersedes_id"),
  ...timestamps
}, (table) => [
  uniqueIndex("model_route_revision_version").on(table.organizationId, table.route, table.version)
]);

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
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
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
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps
});

export const documentConversions = pgTable("document_conversions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  status: text("status").default("queued").notNull(),
  engine: text("engine").notNull(),
  engineVersion: text("engine_version").notNull(),
  sourceHash: text("source_hash").notNull(),
  language: text("language"),
  ocrUsed: boolean("ocr_used").default(false).notNull(),
  confidence: integer("confidence").default(0).notNull(),
  warnings: jsonb("warnings").$type<string[]>().default([]).notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  errorCode: text("error_code"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  index("document_conversion_document_status_idx").on(table.documentId, table.status)
]);

export const documentPages = pgTable("document_pages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversionId: uuid("conversion_id").references(() => documentConversions.id, { onDelete: "cascade" }).notNull(),
  pageNumber: integer("page_number").notNull(),
  width: integer("width"),
  height: integer("height"),
  text: text("text").default("").notNull(),
  confidence: integer("confidence").default(0).notNull(),
  imageStorageKey: text("image_storage_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("document_page_conversion_number_idx").on(table.conversionId, table.pageNumber)
]);

export const documentBlocks = pgTable("document_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  pageId: uuid("page_id").references(() => documentPages.id, { onDelete: "cascade" }).notNull(),
  blockType: text("block_type").notNull(),
  position: integer("position").notNull(),
  text: text("text").default("").notNull(),
  bbox: jsonb("bbox").$type<{ x: number; y: number; width: number; height: number } | null>(),
  confidence: integer("confidence").default(0).notNull(),
  extractionMethod: text("extraction_method").notNull(),
  aiRepaired: boolean("ai_repaired").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("document_block_page_position_idx").on(table.pageId, table.position)
]);

export const documentTables = pgTable("document_tables", {
  id: uuid("id").defaultRandom().primaryKey(),
  pageId: uuid("page_id").references(() => documentPages.id, { onDelete: "cascade" }).notNull(),
  position: integer("position").notNull(),
  cells: jsonb("cells").$type<string[][]>().default([]).notNull(),
  bbox: jsonb("bbox").$type<{ x: number; y: number; width: number; height: number } | null>(),
  confidence: integer("confidence").default(0).notNull(),
  markdown: text("markdown").default("").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const documentImages = pgTable("document_images", {
  id: uuid("id").defaultRandom().primaryKey(),
  pageId: uuid("page_id").references(() => documentPages.id, { onDelete: "cascade" }).notNull(),
  position: integer("position").notNull(),
  bbox: jsonb("bbox").$type<{ x: number; y: number; width: number; height: number } | null>(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  width: integer("width"),
  height: integer("height"),
  altText: text("alt_text").default("").notNull(),
  confidence: integer("confidence").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const documentRevisions = pgTable("document_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  revision: integer("revision").notNull(),
  markdown: text("markdown").notNull(),
  contentHash: text("content_hash").notNull(),
  source: text("source").notNull(),
  conversionId: uuid("conversion_id").references(() => documentConversions.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  approved: boolean("approved").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("document_revision_document_number_idx").on(table.documentId, table.revision)
]);

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
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
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

export const brandProfiles = pgTable("brand_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  audience: jsonb("audience").$type<Array<Record<string, unknown>>>().default([]).notNull(),
  positioning: text("positioning").default("").notNull(),
  voice: jsonb("voice").$type<Record<string, unknown>>().default({}).notNull(),
  approvedClaims: jsonb("approved_claims").$type<string[]>().default([]).notNull(),
  prohibitedClaims: jsonb("prohibited_claims").$type<string[]>().default([]).notNull(),
  competitors: jsonb("competitors").$type<string[]>().default([]).notNull(),
  status: text("status").default("draft").notNull(),
  revision: integer("revision").default(1).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("brand_profile_org_project_name_idx").on(table.organizationId, table.projectId, table.name)
]);

export const marketingCampaigns = pgTable("marketing_campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "set null" }),
  brandProfileId: uuid("brand_profile_id").references(() => brandProfiles.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  audiences: jsonb("audiences").$type<Array<Record<string, unknown>>>().default([]).notNull(),
  positioning: jsonb("positioning").$type<string[]>().default([]).notNull(),
  channels: jsonb("channels").$type<string[]>().default([]).notNull(),
  formats: jsonb("formats").$type<string[]>().default([]).notNull(),
  assumptions: jsonb("assumptions").$type<string[]>().default([]).notNull(),
  successMetrics: jsonb("success_metrics").$type<Array<Record<string, unknown>>>().default([]).notNull(),
  status: text("status").default("draft").notNull(),
  approvalState: text("approval_state").default("working").notNull(),
  ...timestamps
});

export const marketingConcepts = pgTable("marketing_concepts", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").references(() => marketingCampaigns.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  rationale: text("rationale").default("").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().default({}).notNull(),
  status: text("status").default("proposed").notNull(),
  decisionReason: text("decision_reason"),
  position: integer("position").default(0).notNull(),
  ...timestamps
});

export const marketingVariants = pgTable("marketing_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  conceptId: uuid("concept_id").references(() => marketingConcepts.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  format: text("format").notNull(),
  content: text("content").default("").notNull(),
  status: text("status").default("draft").notNull(),
  decisionReason: text("decision_reason"),
  ...timestamps
});

export const contentCalendarItems = pgTable("content_calendar_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").references(() => marketingCampaigns.id, { onDelete: "cascade" }).notNull(),
  variantId: uuid("variant_id").references(() => marketingVariants.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  channel: text("channel").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  status: text("status").default("planned").notNull(),
  ...timestamps
});

export const brainstormingSessions = pgTable("brainstorming_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "set null" }),
  prompt: text("prompt").notNull(),
  evaluationCriteria: jsonb("evaluation_criteria").$type<string[]>().default([]).notNull(),
  assumptions: jsonb("assumptions").$type<string[]>().default([]).notNull(),
  status: text("status").default("active").notNull(),
  decisionSummary: text("decision_summary").default("").notNull(),
  ...timestamps
});

export const brainstormingIdeas = pgTable("brainstorming_ideas", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").references(() => brainstormingSessions.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  description: text("description").default("").notNull(),
  scores: jsonb("scores").$type<Record<string, number>>().default({}).notNull(),
  status: text("status").default("candidate").notNull(),
  decisionReason: text("decision_reason"),
  position: integer("position").default(0).notNull(),
  ...timestamps
});

export const marketingExperiments = pgTable("marketing_experiments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  campaignId: uuid("campaign_id").references(() => marketingCampaigns.id, { onDelete: "set null" }),
  sessionId: uuid("session_id").references(() => brainstormingSessions.id, { onDelete: "set null" }),
  hypothesis: text("hypothesis").notNull(),
  method: text("method").notNull(),
  metrics: jsonb("metrics").$type<string[]>().default([]).notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().default({}).notNull(),
  status: text("status").default("planned").notNull(),
  decision: text("decision"),
  ...timestamps
});

export const externalActionProposals = pgTable("external_action_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  campaignId: uuid("campaign_id").references(() => marketingCampaigns.id, { onDelete: "set null" }),
  actionType: text("action_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  status: text("status").default("review_required").notNull(),
  reviewId: uuid("review_id").references(() => reviews.id, { onDelete: "set null" }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  ...timestamps
});

export const gmailConnections = pgTable("gmail_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  googleAccountId: text("google_account_id").notNull(),
  email: text("email").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  encryptedAccessToken: text("encrypted_access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
  status: text("status").default("active").notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  ...timestamps
}, (table) => [
  uniqueIndex("gmail_connection_org_account_idx").on(table.organizationId, table.googleAccountId)
]);

export const gmailOauthStates = pgTable("gmail_oauth_states", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  stateHash: text("state_hash").notNull().unique(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const gmailThreads = pgTable("gmail_threads", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  connectionId: uuid("connection_id").references(() => gmailConnections.id, { onDelete: "cascade" }).notNull(),
  gmailThreadId: text("gmail_thread_id").notNull(),
  historyId: text("history_id"),
  subject: text("subject").default("").notNull(),
  snippet: text("snippet").default("").notNull(),
  participants: jsonb("participants").$type<string[]>().default([]).notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("gmail_thread_connection_external_idx").on(table.connectionId, table.gmailThreadId)
]);

export const gmailMessages = pgTable("gmail_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  connectionId: uuid("connection_id").references(() => gmailConnections.id, { onDelete: "cascade" }).notNull(),
  threadId: uuid("thread_id").references(() => gmailThreads.id, { onDelete: "cascade" }).notNull(),
  gmailMessageId: text("gmail_message_id").notNull(),
  internetMessageId: text("internet_message_id"),
  fromAddress: text("from_address").default("").notNull(),
  toAddresses: jsonb("to_addresses").$type<string[]>().default([]).notNull(),
  ccAddresses: jsonb("cc_addresses").$type<string[]>().default([]).notNull(),
  subject: text("subject").default("").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  snippet: text("snippet").default("").notNull(),
  bodyText: text("body_text").default("").notNull(),
  bodyHtml: text("body_html").default("").notNull(),
  labelIds: jsonb("label_ids").$type<string[]>().default([]).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("gmail_message_connection_external_idx").on(table.connectionId, table.gmailMessageId)
]);

export const gmailAttachments = pgTable("gmail_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  messageId: uuid("message_id").references(() => gmailMessages.id, { onDelete: "cascade" }).notNull(),
  gmailAttachmentId: text("gmail_attachment_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").default("application/octet-stream").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).default(0).notNull(),
  contentHash: text("content_hash"),
  storageKey: text("storage_key"),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("gmail_attachment_message_external_idx").on(table.messageId, table.gmailAttachmentId)
]);

export const gmailProjectLinks = pgTable("gmail_project_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  threadId: uuid("thread_id").references(() => gmailThreads.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").references(() => gmailMessages.id, { onDelete: "cascade" }),
  clientRecordId: uuid("client_record_id"),
  companyId: uuid("company_id"),
  linkedBy: uuid("linked_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("gmail_project_link_subject_idx").on(table.projectId, table.threadId, table.messageId)
]);

export const gmailDrafts = pgTable("gmail_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  connectionId: uuid("connection_id").references(() => gmailConnections.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  threadId: uuid("thread_id").references(() => gmailThreads.id, { onDelete: "set null" }),
  gmailDraftId: text("gmail_draft_id"),
  gmailMessageId: text("gmail_message_id"),
  toAddresses: jsonb("to_addresses").$type<string[]>().default([]).notNull(),
  ccAddresses: jsonb("cc_addresses").$type<string[]>().default([]).notNull(),
  bccAddresses: jsonb("bcc_addresses").$type<string[]>().default([]).notNull(),
  subject: text("subject").default("").notNull(),
  bodyText: text("body_text").default("").notNull(),
  status: text("status").default("draft").notNull(),
  revision: integer("revision").default(1).notNull(),
  ...timestamps
});

export const gmailDraftRevisions = pgTable("gmail_draft_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  draftId: uuid("draft_id").references(() => gmailDrafts.id, { onDelete: "cascade" }).notNull(),
  revision: integer("revision").notNull(),
  toAddresses: jsonb("to_addresses").$type<string[]>().default([]).notNull(),
  ccAddresses: jsonb("cc_addresses").$type<string[]>().default([]).notNull(),
  bccAddresses: jsonb("bcc_addresses").$type<string[]>().default([]).notNull(),
  subject: text("subject").default("").notNull(),
  bodyText: text("body_text").default("").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("gmail_draft_revision_idx").on(table.draftId, table.revision)
]);

export const mcpServers = pgTable("mcp_servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  transport: text("transport").default("streamable_http").notNull(),
  endpoint: text("endpoint").notNull(),
  authSecretRef: text("auth_secret_ref").notNull(),
  status: text("status").default("active").notNull(),
  healthStatus: text("health_status").default("unknown").notNull(),
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  capabilities: jsonb("capabilities").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("mcp_server_org_name_idx").on(table.organizationId, table.name)
]);

export const mcpTools = pgTable("mcp_tools", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  serverId: uuid("server_id").references(() => mcpServers.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description").default("").notNull(),
  inputSchema: jsonb("input_schema").$type<Record<string, unknown>>().default({}).notNull(),
  outputSchema: jsonb("output_schema").$type<Record<string, unknown>>().default({}).notNull(),
  group: text("group").notNull(),
  riskLevel: text("risk_level").default("low").notNull(),
  approvalRequirement: text("approval_requirement").default("none").notNull(),
  budgetCents: bigint("budget_cents", { mode: "number" }),
  permissions: jsonb("permissions").$type<string[]>().default([]).notNull(),
  active: boolean("active").default(true).notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).defaultNow().notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("mcp_tool_server_name_idx").on(table.serverId, table.name),
  index("mcp_tool_org_group_idx").on(table.organizationId, table.group)
]);

export const mcpResources = pgTable("mcp_resources", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  serverId: uuid("server_id").references(() => mcpServers.id, { onDelete: "cascade" }).notNull(),
  uri: text("uri").notNull(),
  name: text("name").notNull(),
  description: text("description").default("").notNull(),
  mimeType: text("mime_type"),
  permissions: jsonb("permissions").$type<string[]>().default([]).notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("mcp_resource_server_uri_idx").on(table.serverId, table.uri)
]);

export const mcpPrompts = pgTable("mcp_prompts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  serverId: uuid("server_id").references(() => mcpServers.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description").default("").notNull(),
  arguments: jsonb("arguments").$type<Array<Record<string, unknown>>>().default([]).notNull(),
  permissions: jsonb("permissions").$type<string[]>().default([]).notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("mcp_prompt_server_name_idx").on(table.serverId, table.name)
]);

export const mcpToolGrants = pgTable("mcp_tool_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  toolId: uuid("tool_id").references(() => mcpTools.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  allowed: boolean("allowed").default(true).notNull(),
  maxCalls: integer("max_calls"),
  maxCostCents: bigint("max_cost_cents", { mode: "number" }),
  ...timestamps
}, (table) => [
  uniqueIndex("mcp_tool_grant_scope_idx").on(table.toolId, table.role, table.projectId)
]);

export const mcpDiscoveries = pgTable("mcp_discoveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  serverId: uuid("server_id").references(() => mcpServers.id, { onDelete: "cascade" }).notNull(),
  status: text("status").notNull(),
  toolsCount: integer("tools_count").default(0).notNull(),
  resourcesCount: integer("resources_count").default(0).notNull(),
  promptsCount: integer("prompts_count").default(0).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const mcpInvocations = pgTable("mcp_invocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  serverId: uuid("server_id").references(() => mcpServers.id, { onDelete: "cascade" }).notNull(),
  toolId: uuid("tool_id").references(() => mcpTools.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  workerRunId: uuid("worker_run_id").references(() => workerRuns.id, { onDelete: "set null" }),
  reviewId: uuid("review_id").references(() => reviews.id, { onDelete: "set null" }),
  role: text("role").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().default({}).notNull(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  status: text("status").notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  costCents: bigint("cost_cents", { mode: "number" }).default(0).notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
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

export const workflowPlans = pgTable("workflow_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }).notNull(),
  revision: integer("revision").default(1).notNull(),
  status: text("status").default("active").notNull(),
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
  estimatedCostCents: bigint("estimated_cost_cents", { mode: "number" }).default(0).notNull(),
  ...timestamps
}, (table) => [uniqueIndex("workflow_plan_run_revision").on(table.runId, table.revision)]);

export const workerRuns = pgTable("worker_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }).notNull(),
  taskKey: text("task_key").notNull(),
  workerType: text("worker_type").notNull(),
  modelRoute: text("model_route").notNull(),
  status: text("status").default("queued").notNull(),
  attempt: integer("attempt").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(3).notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().default({}).notNull(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  error: text("error"),
  costMicros: bigint("cost_micros", { mode: "number" }).default(0).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps
}, (table) => [uniqueIndex("worker_run_task").on(table.runId, table.taskKey)]);

export const workflowStates = pgTable("workflow_states", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }).notNull().unique(),
  triggerRunId: text("trigger_run_id"),
  status: text("status").default("queued").notNull(),
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().default({}).notNull(),
  attempt: integer("attempt").default(0).notNull(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).defaultNow().notNull(),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  terminalAt: timestamp("terminal_at", { withTimezone: true }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  ...timestamps
});

export const budgetLedgers = pgTable("budget_ledgers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  scopeType: text("scope_type").notNull(),
  scopeId: uuid("scope_id").notNull(),
  limitCents: bigint("limit_cents", { mode: "number" }).notNull(),
  reservedCents: bigint("reserved_cents", { mode: "number" }).default(0).notNull(),
  spentCents: bigint("spent_cents", { mode: "number" }).default(0).notNull(),
  ...timestamps
}, (table) => [uniqueIndex("budget_ledger_scope").on(table.organizationId, table.scopeType, table.scopeId)]);

export const deadLetters = pgTable("dead_letters", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }).notNull(),
  workerRunId: uuid("worker_run_id").references(() => workerRuns.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  error: text("error").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

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

export const clientChangeSets = pgTable("client_change_sets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  databaseId: uuid("database_id").references(() => clientDatabases.id, { onDelete: "cascade" }).notNull(),
  reviewId: uuid("review_id").references(() => reviews.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  reason: text("reason").default("").notNull(),
  status: text("status").default("draft").notNull(),
  revision: integer("revision").default(1).notNull(),
  contentHash: text("content_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("client_change_set_org_idempotency_idx").on(table.organizationId, table.idempotencyKey),
  index("client_change_set_project_status_idx").on(table.projectId, table.status)
]);

export const clientChangeItems = pgTable("client_change_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  changeSetId: uuid("change_set_id").references(() => clientChangeSets.id, { onDelete: "cascade" }).notNull(),
  operation: text("operation").notNull(),
  recordId: uuid("record_id"),
  mergeRecordId: uuid("merge_record_id"),
  before: jsonb("before").$type<Record<string, string> | null>(),
  mergeBefore: jsonb("merge_before").$type<Record<string, string> | null>(),
  after: jsonb("after").$type<Record<string, string> | null>(),
  changedFields: jsonb("changed_fields").$type<string[]>().default([]).notNull(),
  sourceEvidenceIds: jsonb("source_evidence_ids").$type<string[]>().default([]).notNull(),
  confidence: integer("confidence").default(0).notNull(),
  validationWarnings: jsonb("validation_warnings").$type<string[]>().default([]).notNull(),
  duplicateRecordIds: jsonb("duplicate_record_ids").$type<string[]>().default([]).notNull(),
  status: text("status").default("pending").notNull(),
  decisionNote: text("decision_note"),
  position: integer("position").default(0).notNull(),
  ...timestamps
});

export const reviewDecisions = pgTable("review_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  reviewId: uuid("review_id").references(() => reviews.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  decision: text("decision").notNull(),
  note: text("note").default("").notNull(),
  selectedItemIds: jsonb("selected_item_ids").$type<string[]>().default([]).notNull(),
  proposalHash: text("proposal_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const clientChangeApprovals = pgTable("client_change_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  changeSetId: uuid("change_set_id").references(() => clientChangeSets.id, { onDelete: "cascade" }).notNull(),
  reviewDecisionId: uuid("review_decision_id").references(() => reviewDecisions.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  proposalHash: text("proposal_hash").notNull(),
  selectedItemIds: jsonb("selected_item_ids").$type<string[]>().default([]).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const clientChangeApplications = pgTable("client_change_applications", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  changeSetId: uuid("change_set_id").references(() => clientChangeSets.id, { onDelete: "cascade" }).notNull().unique(),
  approvalId: uuid("approval_id").references(() => clientChangeApprovals.id, { onDelete: "restrict" }).notNull(),
  status: text("status").notNull(),
  appliedItemIds: jsonb("applied_item_ids").$type<string[]>().default([]).notNull(),
  conflictItemIds: jsonb("conflict_item_ids").$type<string[]>().default([]).notNull(),
  error: text("error"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  ...timestamps
});

export const clientChangeSnapshots = pgTable("client_change_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id").references(() => clientChangeApplications.id, { onDelete: "cascade" }).notNull(),
  itemId: uuid("item_id").references(() => clientChangeItems.id, { onDelete: "restrict" }).notNull(),
  recordId: uuid("record_id").notNull(),
  operation: text("operation").notNull(),
  before: jsonb("before").$type<Record<string, string> | null>(),
  after: jsonb("after").$type<Record<string, string> | null>(),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("client_change_snapshot_application_item_record_idx").on(
    table.applicationId,
    table.itemId,
    table.recordId
  )
]);

export const canonicalCompanies = pgTable("canonical_companies", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  legalName: text("legal_name").notNull(),
  tradingNames: jsonb("trading_names").$type<string[]>().default([]).notNull(),
  normalizedName: text("normalized_name").notNull(),
  normalizedDomain: text("normalized_domain"),
  countryCode: text("country_code"),
  locations: jsonb("locations").$type<Array<Record<string, string>>>().default([]).notNull(),
  classifications: jsonb("classifications").$type<string[]>().default([]).notNull(),
  confidence: integer("confidence").default(0).notNull(),
  completeness: integer("completeness").default(0).notNull(),
  firstResearchedAt: timestamp("first_researched_at", { withTimezone: true }).defaultNow().notNull(),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  index("canonical_company_org_name_idx").on(table.organizationId, table.normalizedName, table.countryCode),
  uniqueIndex("canonical_company_org_domain_idx").on(table.organizationId, table.normalizedDomain)
]);

export const companyIdentifiers = pgTable("company_identifiers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  companyId: uuid("company_id").references(() => canonicalCompanies.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),
  value: text("value").notNull(),
  issuingCountry: text("issuing_country"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("company_identifier_org_type_value_idx").on(table.organizationId, table.type, table.value)
]);

export const companySources = pgTable("company_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  companyId: uuid("company_id").references(() => canonicalCompanies.id, { onDelete: "cascade" }).notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type").default("web").notNull(),
  title: text("title").default("").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}).notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("company_source_company_url_idx").on(table.companyId, table.sourceUrl)
]);

export const companyProjectLinks = pgTable("company_project_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  companyId: uuid("company_id").references(() => canonicalCompanies.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "set null" }),
  disposition: text("disposition").default("in_scope").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("company_project_link_idx").on(table.companyId, table.projectId, table.agendaId)
]);

export const researchCampaigns = pgTable("research_campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  scope: jsonb("scope").$type<Record<string, unknown>>().default({}).notNull(),
  qualificationRules: jsonb("qualification_rules").$type<string[]>().default([]).notNull(),
  requiredFields: jsonb("required_fields").$type<string[]>().default([]).notNull(),
  exclusions: jsonb("exclusions").$type<string[]>().default([]).notNull(),
  sourcePlan: jsonb("source_plan").$type<string[]>().default([]).notNull(),
  queryPlan: jsonb("query_plan").$type<string[]>().default([]).notNull(),
  targetCount: integer("target_count").notNull(),
  existingCountPolicy: text("existing_count_policy").default("ask").notNull(),
  status: text("status").default("draft").notNull(),
  discoveredCount: integer("discovered_count").default(0).notNull(),
  acceptedCount: integer("accepted_count").default(0).notNull(),
  rejectedCount: integer("rejected_count").default(0).notNull(),
  duplicateCount: integer("duplicate_count").default(0).notNull(),
  unresolvedCount: integer("unresolved_count").default(0).notNull(),
  estimatedRemaining: integer("estimated_remaining"),
  saturationReason: text("saturation_reason"),
  costCents: bigint("cost_cents", { mode: "number" }).default(0).notNull(),
  ...timestamps
});

export const companyCandidates = pgTable("company_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  fingerprint: text("fingerprint").notNull(),
  proposedName: text("proposed_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  normalizedDomain: text("normalized_domain"),
  countryCode: text("country_code"),
  address: text("address"),
  canonicalCompanyId: uuid("canonical_company_id").references(() => canonicalCompanies.id, { onDelete: "set null" }),
  resolution: text("resolution").default("new").notNull(),
  resolutionReason: text("resolution_reason"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("company_candidate_org_fingerprint_idx").on(table.organizationId, table.fingerprint),
  index("company_candidate_org_name_idx").on(table.organizationId, table.normalizedName, table.countryCode)
]);

export const campaignCandidates = pgTable("campaign_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").references(() => researchCampaigns.id, { onDelete: "cascade" }).notNull(),
  candidateId: uuid("candidate_id").references(() => companyCandidates.id, { onDelete: "cascade" }).notNull(),
  status: text("status").default("new").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("campaign_candidate_idx").on(table.campaignId, table.candidateId)
]);

export const companyResearchClaims = pgTable("company_research_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  campaignId: uuid("campaign_id").references(() => researchCampaigns.id, { onDelete: "cascade" }).notNull(),
  candidateId: uuid("candidate_id").references(() => companyCandidates.id, { onDelete: "cascade" }).notNull(),
  workerRunId: uuid("worker_run_id").references(() => workerRuns.id, { onDelete: "set null" }),
  leaseToken: text("lease_token").notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("company_research_active_claim_idx").on(table.campaignId, table.candidateId),
  index("company_research_lease_idx").on(table.leaseExpiresAt)
]);

// Phase 13 Stage 1 - Generic Ledger. A sibling to the company-research tables
// above, not a replacement: those stay company-specific (canonical registry,
// org-wide fingerprint reuse across projects). These are schema-agnostic —
// `entitySchema`/`data` hold whatever columns a given campaign's Blueprint
// step decided on, so dedupe is scoped per-campaign, not per-organization,
// since two campaigns can describe entities with nothing in common.
export const collectionCampaigns = pgTable("collection_campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  entitySchema: jsonb("entity_schema").$type<Array<{ name: string; description: string }>>().default([]).notNull(),
  documentTemplate: text("document_template").default("").notNull(),
  dedupeKeys: jsonb("dedupe_keys").$type<string[]>().default([]).notNull(),
  qualificationRules: jsonb("qualification_rules").$type<string[]>().default([]).notNull(),
  targetCount: integer("target_count"),
  saturationRule: text("saturation_rule"),
  status: text("status").default("draft").notNull(),
  discoveredCount: integer("discovered_count").default(0).notNull(),
  acceptedCount: integer("accepted_count").default(0).notNull(),
  rejectedCount: integer("rejected_count").default(0).notNull(),
  duplicateCount: integer("duplicate_count").default(0).notNull(),
  saturationReason: text("saturation_reason"),
  // Stage 5 (Cross-Link): where this campaign publishes. The change set is the
  // staged, human-approvable proposal for the client-data rows - records do
  // not exist until someone approves and applies it.
  databaseId: uuid("database_id").references(() => clientDatabases.id, { onDelete: "set null" }),
  changeSetId: uuid("change_set_id").references(() => clientChangeSets.id, { onDelete: "set null" }),
  costCents: bigint("cost_cents", { mode: "number" }).default(0).notNull(),
  ...timestamps
});

export const collectionCandidates = pgTable("collection_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  campaignId: uuid("campaign_id").references(() => collectionCampaigns.id, { onDelete: "cascade" }).notNull(),
  fingerprint: text("fingerprint").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
  resolution: text("resolution").default("new").notNull(),
  resolutionReason: text("resolution_reason"),
  // Stage 4 (Dossier Loop) outcome - separate from `resolution` above, which
  // is the entity's discovery identity and never changes after Stage 3.
  // pending | researching | completed | disqualified | failed
  dossierStatus: text("dossier_status").default("pending").notNull(),
  dossierMarkdown: text("dossier_markdown"),
  dossierReason: text("dossier_reason"),
  linkedRecordId: uuid("linked_record_id").references(() => clientRecords.id, { onDelete: "set null" }),
  linkedDocumentId: uuid("linked_document_id").references(() => documents.id, { onDelete: "set null" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("collection_candidate_campaign_fingerprint_idx").on(table.campaignId, table.fingerprint)
]);

export const collectionCandidateClaims = pgTable("collection_candidate_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  campaignId: uuid("campaign_id").references(() => collectionCampaigns.id, { onDelete: "cascade" }).notNull(),
  candidateId: uuid("candidate_id").references(() => collectionCandidates.id, { onDelete: "cascade" }).notNull(),
  workerRunId: uuid("worker_run_id").references(() => workerRuns.id, { onDelete: "set null" }),
  leaseToken: text("lease_token").notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("collection_candidate_active_claim_idx").on(table.campaignId, table.candidateId),
  index("collection_candidate_lease_idx").on(table.leaseExpiresAt)
]);

export const researchProviders = pgTable("research_providers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  baseUrl: text("base_url").notNull(),
  credentialEnv: text("credential_env"),
  requiresCredential: boolean("requires_credential").default(false).notNull(),
  priority: integer("priority").default(100).notNull(),
  requestsPerSecond: integer("requests_per_second").default(1).notNull(),
  concurrency: integer("concurrency").default(1).notNull(),
  dailyQueryLimit: integer("daily_query_limit"),
  cacheTtlSeconds: integer("cache_ttl_seconds").default(86400).notNull(),
  policyUrl: text("policy_url"),
  policy: jsonb("policy").$type<Record<string, unknown>>().default({}).notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("research_provider_org_key_idx").on(table.organizationId, table.key)
]);

export const researchQueries = pgTable("research_queries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  agendaId: uuid("agenda_id").references(() => agendas.id, { onDelete: "cascade" }).notNull(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  query: text("query").notNull(),
  category: text("category").default("web").notNull(),
  language: text("language").default("en").notNull(),
  status: text("status").default("queued").notNull(),
  queryBudget: integer("query_budget").default(10).notNull(),
  queriesUsed: integer("queries_used").default(0).notNull(),
  costCents: bigint("cost_cents", { mode: "number" }).default(0).notNull(),
  coverage: jsonb("coverage").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
});

export const researchEvidence = pgTable("research_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  queryId: uuid("query_id").references(() => researchQueries.id, { onDelete: "cascade" }).notNull(),
  providerId: uuid("provider_id").references(() => researchProviders.id, { onDelete: "restrict" }).notNull(),
  publisher: text("publisher").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  excerpt: text("excerpt").default("").notNull(),
  originalEvidence: jsonb("original_evidence").$type<Record<string, unknown>>().default({}).notNull(),
  language: text("language").default("unknown").notNull(),
  license: text("license"),
  contentHash: text("content_hash").notNull(),
  citation: text("citation").notNull(),
  confidence: integer("confidence").default(0).notNull(),
  qualityScore: integer("quality_score").default(0).notNull(),
  evidenceState: text("evidence_state").default("available").notNull(),
  cacheState: text("cache_state").default("miss").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("research_evidence_query_hash_idx").on(table.queryId, table.contentHash),
  index("research_evidence_query_state_idx").on(table.queryId, table.evidenceState)
]);

export const researchProviderAttempts = pgTable("research_provider_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  queryId: uuid("query_id").references(() => researchQueries.id, { onDelete: "cascade" }).notNull(),
  providerId: uuid("provider_id").references(() => researchProviders.id, { onDelete: "restrict" }).notNull(),
  attempt: integer("attempt").default(1).notNull(),
  status: text("status").notNull(),
  httpStatus: integer("http_status"),
  resultCount: integer("result_count").default(0).notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  retryAfterMs: integer("retry_after_ms"),
  fallbackFrom: text("fallback_from"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const researchCache = pgTable("research_cache", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  providerId: uuid("provider_id").references(() => researchProviders.id, { onDelete: "cascade" }).notNull(),
  cacheKey: text("cache_key").notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().default({}).notNull(),
  etag: text("etag"),
  hitCount: integer("hit_count").default(0).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("research_cache_provider_key_idx").on(table.providerId, table.cacheKey)
]);

export const researchContradictions = pgTable("research_contradictions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  queryId: uuid("query_id").references(() => researchQueries.id, { onDelete: "cascade" }).notNull(),
  claimKey: text("claim_key").notNull(),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().default([]).notNull(),
  description: text("description").notNull(),
  status: text("status").default("unresolved").notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("research_contradiction_query_claim_idx").on(table.queryId, table.claimKey)
]);

export const researchDomainPolicies = pgTable("research_domain_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  domain: text("domain").notNull(),
  access: text("access").default("allow").notNull(),
  robotsPolicy: text("robots_policy").default("respect").notNull(),
  requestsPerSecond: integer("requests_per_second").default(1).notNull(),
  reason: text("reason"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("research_domain_policy_org_domain_idx").on(table.organizationId, table.domain)
]);

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
